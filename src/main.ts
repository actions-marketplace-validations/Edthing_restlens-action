import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import {
  flattenViolationsWithLines,
  buildViolationSummary,
  type ViolationKV,
  type FlatViolation,
  type ViolationSummary,
} from "@restlens/lib";

// =============================================================================
// Types
// =============================================================================

interface EvaluationResult {
  specificationVersionId: string;
  violations: ViolationKV[];
  evaluationUrl: string;
}

interface PRFeedbackResponse {
  success: boolean;
  commentUrl: string | null;
  reviewUrl: string | null;
  violationCount: number;
}

interface UploadResponse {
  specificationVersionId: string;
  projectSlug: string;
  organizationSlug: string;
}

interface ViolationsResponse {
  status: "pending" | "in_progress" | "ready" | "failed";
  violations?: ViolationKV[];
  error?: string;
}

// =============================================================================
// Main Action
// =============================================================================

async function run(): Promise<void> {
  try {
    // Get inputs
    const apiToken = core.getInput("api-token", { required: true });
    const specPath = core.getInput("spec-path", { required: true });
    const failOnError = core.getBooleanInput("fail-on-error");
    const failOnWarning = core.getBooleanInput("fail-on-warning");
    const postPrComment = core.getBooleanInput("post-pr-comment");
    const postInlineComments = core.getBooleanInput("post-inline-comments");
    const apiUrl = core.getInput("api-url") || "https://api.restlens.dev";

    // Mask the API token
    core.setSecret(apiToken);

    // Find spec files
    const specFiles = await glob(specPath, { nodir: true });
    if (specFiles.length === 0) {
      throw new Error(`No files found matching pattern: ${specPath}`);
    }

    core.info(`Found ${specFiles.length} specification file(s)`);

    // Process each spec file
    let totalErrors = 0;
    let totalWarnings = 0;
    let totalInfos = 0;
    const allViolations: FlatViolation[] = [];
    let lastEvaluationUrl = "";

    for (const specFile of specFiles) {
      core.info(`\nEvaluating: ${specFile}`);

      // Read spec file
      const specContent = fs.readFileSync(specFile, "utf8");

      // Upload and evaluate
      const result = await evaluateSpec(apiUrl, apiToken, specFile, specContent);

      if (result.violations.length === 0) {
        core.info("  No violations found");
      } else {
        // Flatten violations and calculate line numbers using the spec content
        const flatViolations = flattenViolationsWithLines(result.violations, specContent);

        for (const v of flatViolations) {
          const location = `:${v.line}`;
          const prefix = v.severity === "error" ? "::error" :
            v.severity === "warning" ? "::warning" : "::notice";
          core.info(`  ${prefix} file=${specFile}${location}::${v.ruleName}: ${v.message}`);

          if (v.severity === "error") totalErrors++;
          else if (v.severity === "warning") totalWarnings++;
          else totalInfos++;
        }
        allViolations.push(...flatViolations);
      }

      lastEvaluationUrl = result.evaluationUrl;
    }

    // Build summary
    const summary: ViolationSummary = buildViolationSummary(allViolations);

    // Set outputs
    core.setOutput("total-violations", summary.totalViolations);
    core.setOutput("error-count", summary.errorCount);
    core.setOutput("warning-count", summary.warningCount);
    core.setOutput("info-count", summary.infoCount);
    core.setOutput("evaluation-url", lastEvaluationUrl);

    // Check if this is a PR
    const isPR = github.context.eventName === "pull_request" ||
                 github.context.eventName === "pull_request_target";

    // Post PR feedback if enabled and this is a PR
    if (isPR && (postPrComment || postInlineComments)) {
      const prNumber = github.context.payload.pull_request?.number;
      const commitSha = github.context.payload.pull_request?.head?.sha || github.context.sha;

      if (prNumber) {
        try {
          core.info("\nPosting PR feedback...");
          const feedbackResult = await postPRFeedback(
            apiUrl,
            apiToken,
            github.context.repo.owner,
            github.context.repo.repo,
            prNumber,
            commitSha,
            specFiles[0], // Use first spec file for now
            summary,
            allViolations, // All violations now have line numbers
            postInlineComments
          );

          if (feedbackResult.commentUrl) {
            core.setOutput("comment-url", feedbackResult.commentUrl);
            core.info(`PR comment posted: ${feedbackResult.commentUrl}`);
          }

          if (feedbackResult.reviewUrl) {
            core.info(`PR review created: ${feedbackResult.reviewUrl}`);
          }
        } catch (error) {
          core.warning(`Failed to post PR feedback: ${error instanceof Error ? error.message : error}`);
          // Don't fail the action if PR feedback fails
        }
      }
    }

    // Determine pass/fail
    const failed = (failOnError && totalErrors > 0) ||
                   (failOnWarning && totalWarnings > 0);

    core.setOutput("passed", !failed);

    // Print summary
    core.info("\n" + "=".repeat(60));
    core.info("REST Lens Evaluation Summary");
    core.info("=".repeat(60));
    core.info(`Total violations: ${summary.totalViolations}`);
    if (totalErrors > 0) core.info(`  Errors: ${totalErrors}`);
    if (totalWarnings > 0) core.info(`  Warnings: ${totalWarnings}`);
    if (totalInfos > 0) core.info(`  Info: ${totalInfos}`);
    core.info(`\nView full results: ${lastEvaluationUrl}`);
    core.info("=".repeat(60));

    if (failed) {
      const reasons: string[] = [];
      if (failOnError && totalErrors > 0) reasons.push(`${totalErrors} error(s)`);
      if (failOnWarning && totalWarnings > 0) reasons.push(`${totalWarnings} warning(s)`);
      core.setFailed(`Evaluation failed: ${reasons.join(", ")}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

// =============================================================================
// API Functions
// =============================================================================

async function evaluateSpec(
  apiUrl: string,
  apiToken: string,
  filename: string,
  content: string
): Promise<EvaluationResult> {
  // Upload specification
  const uploadResponse = await fetch(`${apiUrl}/v1/specifications`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename: path.basename(filename),
      content,
      evaluate: true, // Trigger evaluation immediately
    }),
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`Failed to upload specification: ${error}`);
  }

  const uploadResult = await uploadResponse.json() as UploadResponse;
  const specVersionId = uploadResult.specificationVersionId;
  const projectSlug = uploadResult.projectSlug;
  const orgSlug = uploadResult.organizationSlug;

  // Wait for evaluation to complete
  const violations = await waitForEvaluation(apiUrl, apiToken, specVersionId);

  // Build evaluation URL
  const baseUrl = apiUrl.replace("/api", "").replace("api.", "");
  const evaluationUrl = `${baseUrl}/organizations/${orgSlug}/projects/${encodeURIComponent(projectSlug)}`;

  return {
    specificationVersionId: specVersionId,
    violations,
    evaluationUrl,
  };
}

async function waitForEvaluation(
  apiUrl: string,
  apiToken: string,
  specVersionId: string,
  maxAttempts = 60,
  intervalMs = 2000
): Promise<ViolationKV[]> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${apiUrl}/v1/specifications/${specVersionId}/violations`, {
      headers: {
        "Authorization": `Bearer ${apiToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Evaluation not ready yet
        await sleep(intervalMs);
        continue;
      }
      const error = await response.text();
      throw new Error(`Failed to get violations: ${error}`);
    }

    const result = await response.json() as ViolationsResponse;

    // Check if evaluation is complete
    if (result.status === "pending" || result.status === "in_progress") {
      await sleep(intervalMs);
      continue;
    }

    if (result.status === "failed") {
      throw new Error(`Evaluation failed: ${result.error || "Unknown error"}`);
    }

    // Evaluation complete
    return result.violations || [];
  }

  throw new Error("Evaluation timed out");
}

async function postPRFeedback(
  apiUrl: string,
  apiToken: string,
  owner: string,
  repo: string,
  pullNumber: number,
  commitSha: string,
  specFilePath: string,
  summary: ViolationSummary,
  inlineViolations: FlatViolation[],
  postInlineComments: boolean
): Promise<PRFeedbackResponse> {
  const response = await fetch(`${apiUrl}/github-app/pr-feedback`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      owner,
      repo,
      pullNumber,
      commitSha,
      specFilePath,
      summary,
      inlineViolations: inlineViolations.map(v => ({
        path: specFilePath, // Use the spec file path
        line: v.line,
        ruleId: v.ruleId,
        ruleName: v.ruleName,
        message: v.message,
        severity: v.severity,
      })),
      postInlineComments,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to post PR feedback: ${error}`);
  }

  return await response.json() as PRFeedbackResponse;
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Run
// =============================================================================

run();
