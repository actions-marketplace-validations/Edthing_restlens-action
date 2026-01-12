# REST Lens GitHub Action

Evaluate your OpenAPI specifications against REST Lens best practices directly in your CI/CD pipeline.

## Features

- Evaluate OpenAPI/Swagger specifications against REST Lens rules
- Post summary comments on pull requests
- Add inline review comments on specific violations
- Fail builds on error or warning severity violations
- Support for glob patterns to evaluate multiple specs

## Usage

```yaml
name: API Evaluation

on:
  pull_request:
    paths:
      - '**/*.yaml'
      - '**/*.yml'
      - '**/*.json'

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Evaluate OpenAPI Spec
        uses: Edthing/restlens-action@v1
        with:
          api-token: ${{ secrets.RESTLENS_API_TOKEN }}
          spec-path: 'openapi.yaml'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `api-token` | REST Lens project API token (create in project settings) | Yes | - |
| `spec-path` | Path to the OpenAPI specification file (supports glob patterns) | Yes | - |
| `fail-on-error` | Fail the action if any error-severity violations are found | No | `true` |
| `fail-on-warning` | Fail the action if any warning-severity violations are found | No | `false` |
| `post-pr-comment` | Post a summary comment on the PR | No | `true` |
| `post-inline-comments` | Post inline review comments on violations | No | `true` |
| `api-url` | REST Lens API base URL (for self-hosted instances) | No | `https://api.restlens.dev` |

## Outputs

| Output | Description |
|--------|-------------|
| `total-violations` | Total number of violations found |
| `error-count` | Number of error-severity violations |
| `warning-count` | Number of warning-severity violations |
| `info-count` | Number of info-severity violations |
| `evaluation-url` | URL to view full evaluation results |
| `comment-url` | URL of the PR comment (if posted) |
| `passed` | Whether the evaluation passed (no violations above threshold) |

## Examples

### Evaluate multiple specs

```yaml
- uses: Edthing/restlens-action@v1
  with:
    api-token: ${{ secrets.RESTLENS_API_TOKEN }}
    spec-path: 'specs/**/*.yaml'
```

### Fail on warnings too

```yaml
- uses: Edthing/restlens-action@v1
  with:
    api-token: ${{ secrets.RESTLENS_API_TOKEN }}
    spec-path: 'openapi.yaml'
    fail-on-warning: 'true'
```

### Disable PR comments

```yaml
- uses: Edthing/restlens-action@v1
  with:
    api-token: ${{ secrets.RESTLENS_API_TOKEN }}
    spec-path: 'openapi.yaml'
    post-pr-comment: 'false'
    post-inline-comments: 'false'
```

## Getting Started

1. Sign up at [restlens.dev](https://restlens.dev)
2. Create a project and get your API token from project settings
3. Add the token as a repository secret (`RESTLENS_API_TOKEN`)
4. Add the action to your workflow

## PR Comments

When running on pull requests, the action can post:

- **Summary comment**: Overview of violations with counts by severity
- **Inline comments**: Review comments on specific lines in your OpenAPI spec

To enable PR comments, you need to install the REST Lens GitHub App on your repository.

## License

MIT
