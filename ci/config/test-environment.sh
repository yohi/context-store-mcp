#!/usr/bin/env bash
#
# Test Environment Configuration
# Configuration file for PR container tests
#
# This file is sourced by test scripts to set up the test environment.
# All environment variables and functions defined here will be available
# to the calling script.
#
# NOTE: Sensitive credentials (passwords, API keys) should be loaded from
# .env.test file, not hardcoded here.

# Test environment variables
export TEST_ENV="ci"
export NODE_ENV="test"
export CI=true

# Database configuration (non-sensitive)
export POSTGRES_DB="context_store_test"
export POSTGRES_USER="test_user"
# POSTGRES_PASSWORD is loaded from .env.test by the test script
export POSTGRES_HOST="localhost"
export POSTGRES_PORT="5432"

# Neo4j configuration (non-sensitive)
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USER="neo4j"
# NEO4J_PASSWORD is loaded from .env.test by the test script

# Redis configuration
export REDIS_HOST="localhost"
export REDIS_PORT="6379"

# Test execution settings
export TEST_TIMEOUT="60000"
export TEST_PARALLEL="false"
export COVERAGE_THRESHOLD="80"

# Docker compose settings
export COMPOSE_PROJECT_NAME="context-store-mcp-test"
export COMPOSE_FILE="docker-compose.test.yml"

# Logging configuration
export LOG_LEVEL="info"
export LOG_FORMAT="json"

# Rundeck logging configuration
# Set to WARN to preserve startup warnings and informational logs for debugging
# while suppressing verbose DEBUG/TRACE output
export RUNDECK_LOGGING_LEVEL="WARN"

echo "Test environment configuration loaded successfully"
