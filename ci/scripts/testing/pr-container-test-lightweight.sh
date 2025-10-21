#!/usr/bin/env bash
#
# PR Container Test - Lightweight Version
# Runs containerized tests for pull requests with minimal resource usage
#
# Usage:
#   ./pr-container-test-lightweight.sh [environment-config-path]
#
# Arguments:
#   environment-config-path: Path to environment configuration file (optional)
#                           Default: ./ci/config/test-environment.sh
#
# Exit codes:
#   0: Success
#   1: Configuration loading failed
#   2: Docker not available
#   3: Test execution failed
#
# Examples:
#   ./pr-container-test-lightweight.sh
#   ./pr-container-test-lightweight.sh ./custom-config.sh

set -euo pipefail

# Script constants
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
readonly DEFAULT_ENV_CONFIG="${PROJECT_ROOT}/ci/config/test-environment.sh"

# Color output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m' # No Color

# Logging functions
log_info() {
  echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $*" >&2
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $*" >&2
}

# Load secrets from .env file securely
# Secrets are loaded into environment variables and tracked for cleanup
load_secrets() {
  local env_file="${PROJECT_ROOT}/ci/config/.env.test"
  local env_example="${PROJECT_ROOT}/ci/config/.env.test.example"

  log_info "Loading test secrets..."

  # Check if .env.test exists, if not try to create from example
  if [[ ! -f "${env_file}" ]]; then
    log_warn "Secrets file not found: ${env_file}"

    if [[ -f "${env_example}" ]]; then
      log_warn "Creating ${env_file} from example template"
      log_warn "Please update ${env_file} with actual test credentials"
      cp "${env_example}" "${env_file}"
      chmod 600 "${env_file}"  # Restrict permissions
    else
      log_error "Neither secrets file nor example template found"
      log_error "Please create ${env_file} with test credentials"
      return 1
    fi
  fi

  # Verify file permissions (should be 600 or stricter)
  local file_perms
  file_perms=$(stat -c '%a' "${env_file}" 2>/dev/null || echo "000")

  if [[ "${file_perms}" != "600" ]] && [[ "${file_perms}" != "400" ]]; then
    log_warn "Secrets file has loose permissions (${file_perms}), setting to 600"
    chmod 600 "${env_file}"
  fi

  # Load secrets from .env file
  # Only export variables that match our expected secret pattern
  if [[ -f "${env_file}" ]]; then
    # shellcheck disable=SC2046
    export $(grep -E '^[A-Z_]+PASSWORD=' "${env_file}" | xargs)

    log_info "Test secrets loaded successfully"
    log_info "Secrets will be automatically cleared after tests"
    return 0
  else
    log_error "Failed to load secrets from ${env_file}"
    return 1
  fi
}

# Clear all loaded secrets from environment
# This ensures no sensitive data remains in memory or logs
cleanup_secrets() {
  log_info "Clearing test secrets from environment..."

  # List of secret environment variables to unset
  local secrets=(
    "POSTGRES_PASSWORD"
    "NEO4J_PASSWORD"
    "RUNDECK_DATABASE_PASSWORD"
    "API_KEY"
    "SECRET_KEY"
  )

  # Unset each secret variable
  for secret in "${secrets[@]}"; do
    if [[ -n "${!secret:-}" ]]; then
      unset "${secret}"
      log_info "Cleared: ${secret}"
    fi
  done

  # Overwrite any temporary files (if created during test)
  local temp_env="/tmp/.env.test.$$"
  if [[ -f "${temp_env}" ]]; then
    # Securely delete temporary file
    shred -vfz -n 3 "${temp_env}" 2>/dev/null || rm -f "${temp_env}"
    log_info "Securely deleted temporary secrets file"
  fi

  log_info "All test secrets cleared successfully"
}

# Load environment configuration with explicit error handling
load_environment_config() {
  local config_path="${1:-${DEFAULT_ENV_CONFIG}}"

  log_info "Loading environment configuration from: ${config_path}"

  # Check if config file exists
  if [[ ! -f "${config_path}" ]]; then
    log_error "Configuration file not found: ${config_path}"
    log_error "Please ensure the environment configuration file exists at the specified path."
    return 1
  fi

  # Check if config file is readable
  if [[ ! -r "${config_path}" ]]; then
    log_error "Configuration file is not readable: ${config_path}"
    log_error "Please check file permissions (current: $(stat -c '%a' "${config_path}" 2>/dev/null || echo 'unknown'))"
    return 1
  fi

  # Attempt to source the configuration file
  # shellcheck disable=SC1090
  if ! source "${config_path}"; then
    log_error "Failed to source configuration file: ${config_path}"
    log_error "The configuration file may contain syntax errors or invalid commands."
    log_error "Please verify the file contents and try again."
    return 1
  fi

  # Success message printed only when sourcing succeeds
  log_info "Successfully loaded environment configuration"
  return 0
}

# Verify Docker availability
check_docker() {
  log_info "Verifying Docker availability..."

  if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed or not in PATH"
    return 2
  fi

  if ! docker info &> /dev/null; then
    log_error "Docker daemon is not running or not accessible"
    log_error "Please ensure Docker is running and you have proper permissions"
    return 2
  fi

  log_info "Docker is available and running"
  return 0
}

# Run lightweight container tests
run_container_tests() {
  log_info "Starting lightweight container tests..."

  # Example test execution (customize based on actual test requirements)
  docker-compose -f "${PROJECT_ROOT}/docker-compose.test.yml" up \
    --build \
    --abort-on-container-exit \
    --exit-code-from test-runner \
    || {
      log_error "Container tests failed"
      return 3
    }

  log_info "Container tests completed successfully"
  return 0
}

# Check Rundeck service health using HTTP status code only
# This function relies solely on HTTP status code (not response body)
# to determine if Rundeck is healthy or still starting up
check_rundeck_health() {
  local rundeck_url="${1:-http://localhost:4440/health}"
  local max_attempts="${2:-30}"
  local retry_interval="${3:-2}"
  local attempt=1

  log_info "Checking Rundeck health at: ${rundeck_url}"
  log_info "Max attempts: ${max_attempts}, retry interval: ${retry_interval}s"

  while [[ ${attempt} -le ${max_attempts} ]]; do
    log_info "Health check attempt ${attempt}/${max_attempts}..."

    # Use curl with -f flag to fail on HTTP errors (4xx, 5xx)
    # -f: Fail silently on HTTP errors
    # -m 3: Maximum time for the operation (3 seconds)
    # -s: Silent mode (no progress bar)
    # -S: Show errors even in silent mode
    # Exit code 0 = HTTP 2xx/3xx (success)
    # Exit code != 0 = HTTP error, timeout, or connection failure
    if timeout 5 curl -f -m 3 -s -S "${rundeck_url}" > /dev/null 2>&1; then
      log_info "Rundeck is HEALTHY (HTTP status 2xx/3xx)"
      return 0
    else
      local curl_exit_code=$?
      log_warn "Rundeck is STARTING (attempt ${attempt}/${max_attempts}, curl exit code: ${curl_exit_code})"

      # If this isn't the last attempt, wait before retrying
      if [[ ${attempt} -lt ${max_attempts} ]]; then
        sleep "${retry_interval}"
      fi
    fi

    ((attempt++))
  done

  # Max attempts reached without success
  log_error "Rundeck health check failed after ${max_attempts} attempts"
  log_error "Service may not be starting correctly or is unreachable"
  return 1
}

# Main execution flow
main() {
  local env_config_path="${1:-${DEFAULT_ENV_CONFIG}}"
  local exit_code=0

  # Setup cleanup trap to ensure secrets are always cleared
  # This runs even if the script exits early due to error
  trap cleanup_secrets EXIT INT TERM

  log_info "PR Container Test - Lightweight (starting)"
  log_info "Project root: ${PROJECT_ROOT}"

  # Load environment configuration with error handling
  if ! load_environment_config "${env_config_path}"; then
    log_error "Exiting due to configuration loading failure"
    exit 1
  fi

  # Load test secrets securely
  if ! load_secrets; then
    log_error "Exiting due to secrets loading failure"
    exit 1
  fi

  # Verify Docker
  if ! check_docker; then
    log_error "Exiting due to Docker availability check failure"
    exit 2
  fi

  # Run tests
  if ! run_container_tests; then
    log_error "Exiting due to test execution failure"
    exit_code=3
  fi

  # Explicit cleanup of secrets before exit
  # (trap will also call this, but explicit is better)
  cleanup_secrets

  if [[ ${exit_code} -eq 0 ]]; then
    log_info "PR Container Test - Lightweight (completed successfully)"
  else
    log_error "PR Container Test - Lightweight (failed with exit code ${exit_code})"
  fi

  exit "${exit_code}"
}

# Execute main function with all script arguments
main "$@"
