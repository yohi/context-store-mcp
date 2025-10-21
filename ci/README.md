# CI/CD Test Infrastructure

Secure test infrastructure for Context Store MCP with comprehensive secret management.

## Overview

This directory contains CI/CD scripts and configuration for running containerized tests with proper secret management and security best practices.

## Directory Structure

```
ci/
├── config/
│   ├── .env.test.example      # Template for test secrets (COMMITTED)
│   ├── .env.test               # Actual test secrets (GITIGNORED)
│   └── test-environment.sh     # Non-sensitive test configuration
└── scripts/
    └── testing/
        └── pr-container-test-lightweight.sh  # Main test script
```

## Security Features

### 🔒 Secret Management

**DO NOT** hardcode passwords or sensitive credentials in scripts or configuration files.

**How it works:**
1. Secrets are stored in `.env.test` (gitignored)
2. Script loads secrets at runtime
3. Secrets are automatically cleared after tests (even on error)
4. File permissions are enforced (600)
5. Temporary files are securely deleted with `shred`

### 🛡️ Security Best Practices

1. **Separation of Secrets**:
   - Non-sensitive config: `test-environment.sh` (committed)
   - Sensitive secrets: `.env.test` (gitignored)

2. **Automatic Cleanup**:
   - Secrets cleared from environment after tests
   - Cleanup runs even on script failure (via trap)
   - Temporary files securely shredded

3. **File Permissions**:
   - `.env.test` automatically set to `600` (owner read/write only)
   - Warning displayed if permissions are too loose

4. **No Log Leakage**:
   - Secrets never logged or printed
   - Environment variables unset after use

## Setup Instructions

### Initial Setup

1. **Create your secrets file:**
   ```bash
   cd ci/config
   cp .env.test.example .env.test
   ```

2. **Edit `.env.test` with your test credentials:**
   ```bash
   # DO NOT commit this file to git!
   nano .env.test
   ```

3. **Verify permissions:**
   ```bash
   chmod 600 .env.test
   ls -la .env.test  # Should show: -rw------- (600)
   ```

### Running Tests

**Basic usage:**
```bash
./ci/scripts/testing/pr-container-test-lightweight.sh
```

**With custom config:**
```bash
./ci/scripts/testing/pr-container-test-lightweight.sh /path/to/custom-config.sh
```

## Environment Variables

### Loaded from `.env.test` (Sensitive)

- `POSTGRES_PASSWORD` - PostgreSQL test database password
- `NEO4J_PASSWORD` - Neo4j test database password
- `RUNDECK_DATABASE_PASSWORD` - (if needed) Rundeck database password
- `API_KEY` - (if needed) API authentication key

### Loaded from `test-environment.sh` (Non-Sensitive)

- `TEST_ENV` - Test environment identifier
- `NODE_ENV` - Node.js environment
- `POSTGRES_DB` - Database name
- `POSTGRES_USER` - Database username
- `POSTGRES_HOST` - Database host
- `POSTGRES_PORT` - Database port
- `NEO4J_URI` - Neo4j connection URI
- `NEO4J_USER` - Neo4j username
- `LOG_LEVEL` - Application log level (info)
- `LOG_FORMAT` - Log output format (json)
- `RUNDECK_LOGGING_LEVEL` - Rundeck log level (WARN)
  - Set to `WARN` to preserve startup warnings and informational logs
  - Suppresses verbose DEBUG/TRACE output while maintaining debuggability
- And more...

## Health Check System

### Rundeck Health Check

The script includes a Rundeck health check function (`check_rundeck_health`) that:

**HTTP Status-Based Detection**:
- Uses `curl -f` to rely **only** on HTTP status codes
- No response body inspection or JSON parsing
- Success: HTTP 2xx/3xx status codes
- Failure: HTTP 4xx/5xx, timeouts, or connection errors

**Usage**:
```bash
# Basic usage (default: localhost:4440/health, 30 attempts, 2s interval)
check_rundeck_health

# Custom URL and retry settings
check_rundeck_health "http://rundeck:4440/health" 60 5
```

**Health States**:
- `HEALTHY` - HTTP 2xx/3xx received (service is ready)
- `STARTING` - HTTP error or timeout (service is still starting)
- `FAILED` - Max attempts reached without success

**Configuration**:
- Default URL: `http://localhost:4440/health`
- Default max attempts: `30`
- Default retry interval: `2` seconds
- Request timeout: `3` seconds (curl `-m 3`)
- Total timeout: `5` seconds (via `timeout` command)

## Exit Codes

- `0` - Success
- `1` - Configuration or secrets loading failed
- `2` - Docker not available
- `3` - Test execution failed

## Troubleshooting

### "Secrets file not found"

**Solution:**
```bash
cd ci/config
cp .env.test.example .env.test
# Edit .env.test with actual credentials
```

### "Secrets file has loose permissions"

**Solution:**
```bash
chmod 600 ci/config/.env.test
```

### Secrets not being cleared

The script uses a `trap` to ensure cleanup runs even on failure. If secrets persist:
```bash
# Manually clear secrets
unset POSTGRES_PASSWORD NEO4J_PASSWORD RUNDECK_DATABASE_PASSWORD
```

## Docker Compose Integration

The script uses `docker-compose` with automatic secret injection:

```yaml
# docker-compose.test.yml (example)
services:
  postgres:
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}  # Loaded from .env.test
```

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Setup test secrets
  run: |
    echo "POSTGRES_PASSWORD=${{ secrets.TEST_POSTGRES_PASSWORD }}" > ci/config/.env.test
    echo "NEO4J_PASSWORD=${{ secrets.TEST_NEO4J_PASSWORD }}" >> ci/config/.env.test
    chmod 600 ci/config/.env.test

- name: Run tests
  run: ./ci/scripts/testing/pr-container-test-lightweight.sh
```

### GitLab CI Example

```yaml
test:
  before_script:
    - echo "POSTGRES_PASSWORD=${TEST_POSTGRES_PASSWORD}" > ci/config/.env.test
    - echo "NEO4J_PASSWORD=${TEST_NEO4J_PASSWORD}" >> ci/config/.env.test
    - chmod 600 ci/config/.env.test
  script:
    - ./ci/scripts/testing/pr-container-test-lightweight.sh
  after_script:
    - rm -f ci/config/.env.test  # Cleanup in CI
```

## Important Security Notes

⚠️ **NEVER commit `.env.test` to version control**
⚠️ **NEVER hardcode passwords in scripts or config files**
⚠️ **ALWAYS use secret management for production environments**
⚠️ **ALWAYS review logs to ensure no secrets are leaked**

## Contributing

When adding new secrets:

1. Add the variable name to `.env.test.example`
2. Update the `cleanup_secrets()` function in the test script
3. Document the new secret in this README

## License

See project LICENSE file.
