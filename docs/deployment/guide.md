# Context Store MCP - Deployment Guide

## Table of Contents

1. [Quick Start](#quick-start)
2. [Prerequisites](#prerequisites)
3. [Configuration](#configuration)
4. [Deployment Methods](#deployment-methods)
5. [Post-Deployment](#post-deployment)
6. [Monitoring](#monitoring)
7. [Troubleshooting](#troubleshooting)
8. [Rollback](#rollback)

## Quick Start

For a quick production deployment:

```bash
# 1. Clone the repository
git clone https://github.com/your-org/context-store-mcp.git
cd context-store-mcp

# 2. Configure environment
cp .env.production.example .env.production
# Edit .env.production with your values

# 3. Run deployment script
./scripts/deploy.sh
```

## Prerequisites

### System Requirements

- **Operating System**: Linux (Ubuntu 20.04+ or RHEL 8+)
- **CPU**: 4+ cores (8+ recommended)
- **RAM**: 8 GB minimum (16 GB recommended)
- **Storage**: 100 GB SSD minimum (500 GB recommended)
- **Network**: 1 Gbps minimum

### Software Requirements

- **Docker**: 24.0 or later
- **Docker Compose**: 2.20 or later
- **Node.js**: 20.x LTS (for build and scripts)
- **Git**: 2.x or later
- **OpenSSL**: 1.1.1 or later

### Installation

#### Ubuntu/Debian

```bash
# Update package list
sudo apt update

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose-plugin

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installations
docker --version
docker compose version
node --version
npm --version
```

#### RHEL/CentOS

```bash
# Install Docker
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker

# Install Node.js 20.x
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# Verify installations
docker --version
docker compose version
node --version
npm --version
```

## Configuration

### 1. Environment Variables

Copy the production environment template:

```bash
cp .env.production.example .env.production
```

Edit `.env.production` and configure the following:

#### Required Variables

```bash
# PostgreSQL
POSTGRES_PASSWORD=<strong-password-here>

# Neo4j
NEO4J_PASSWORD=<strong-password-here>

# Redis
REDIS_PASSWORD=<strong-password-here>

# OpenAI
OPENAI_API_KEY=<your-api-key-here>

# Security
SIGNATURE_SECRET=<generate-with-openssl-rand-base64-32>
```

#### Generate Strong Passwords

```bash
# Generate random passwords
openssl rand -base64 32

# Generate signature secret
openssl rand -base64 32
```

### 2. Resource Configuration

Edit `docker-compose.prod.yml` to adjust resource limits:

```yaml
deploy:
  resources:
    limits:
      cpus: '2'      # Adjust based on your hardware
      memory: 2G     # Adjust based on your hardware
    reservations:
      cpus: '1'
      memory: 1G
```

### 3. Port Configuration

Default ports:
- **Application**: 3000
- **PostgreSQL**: 5432
- **Neo4j HTTP**: 7474
- **Neo4j Bolt**: 7687
- **Redis**: 6379

To change ports, edit `.env.production`:

```bash
APP_PORT=3000
POSTGRES_PORT=5432
NEO4J_HTTP_PORT=7474
NEO4J_BOLT_PORT=7687
REDIS_PORT=6379
```

## Deployment Methods

### Method 1: Automated Deployment (Recommended)

Use the deployment script for a fully automated deployment:

```bash
./scripts/deploy.sh
```

This script will:
1. Check prerequisites
2. Validate environment configuration
3. Run security audit
4. Build the application
5. Build Docker images
6. Run tests
7. Deploy services
8. Run health checks
9. Display deployment status

### Method 2: Manual Deployment

For more control, deploy manually:

```bash
# 1. Install dependencies
npm ci --only=production

# 2. Build TypeScript
npm run build

# 3. Build Docker image
docker build -t context-store-mcp:latest .

# 4. Run tests
npm test -- --run

# 5. Deploy services
docker-compose -f docker-compose.prod.yml up -d

# 6. Verify deployment
docker-compose -f docker-compose.prod.yml ps
```

### Method 3: Docker Compose Only

If you already have a built image:

```bash
# Load environment variables
export $(cat .env.production | grep -v '^#' | xargs)

# Deploy services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps
```

### Method 4: Kubernetes (Advanced)

For Kubernetes deployment, see [kubernetes/README.md](../../kubernetes/README.md).

## Post-Deployment

### 1. Verify Services

Check that all services are running:

```bash
docker-compose -f docker-compose.prod.yml ps
```

Expected output:
```
NAME                          STATUS              PORTS
context-store-mcp-app         Up (healthy)        0.0.0.0:3000->3000/tcp
context-store-postgres-prod   Up (healthy)        0.0.0.0:5432->5432/tcp
context-store-neo4j-prod      Up (healthy)        0.0.0.0:7474->7474/tcp, 0.0.0.0:7687->7687/tcp
context-store-redis-prod      Up (healthy)        0.0.0.0:6379->6379/tcp
```

### 2. Run Health Check

```bash
npm run health-check
```

Or manually:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "services": {
    "postgres": "healthy",
    "neo4j": "healthy",
    "redis": "healthy"
  }
}
```

### 3. Validate Configuration

```bash
npm run validate-config
```

### 4. Run Smoke Tests

```bash
# Test memory storage
curl -X POST http://localhost:3000/api/memory \
  -H "Content-Type: application/json" \
  -d '{"content": "Test memory", "metadata": {}}'

# Test memory search
curl http://localhost:3000/api/memory/search?q=test
```

### 5. Check Logs

```bash
# View all logs
docker-compose -f docker-compose.prod.yml logs -f

# View specific service logs
docker-compose -f docker-compose.prod.yml logs -f app
docker-compose -f docker-compose.prod.yml logs -f postgres
docker-compose -f docker-compose.prod.yml logs -f neo4j
docker-compose -f docker-compose.prod.yml logs -f redis
```

## Monitoring

### 1. Resource Usage

Monitor resource usage:

```bash
# Docker stats
docker stats

# System resources
htop  # or top
df -h  # disk usage
free -h  # memory usage
```

### 2. Application Metrics

Access metrics endpoint (if enabled):

```bash
curl http://localhost:3000/metrics
```

### 3. Database Monitoring

#### PostgreSQL

```bash
# Connect to PostgreSQL
docker exec -it context-store-postgres-prod psql -U context_store_user -d context_store

# Check database size
SELECT pg_size_pretty(pg_database_size('context_store'));

# Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

# Check active connections
SELECT count(*) FROM pg_stat_activity;
```

#### Neo4j

Access Neo4j Browser: http://localhost:7474

```cypher
// Check node count
MATCH (n) RETURN count(n);

// Check relationship count
MATCH ()-[r]->() RETURN count(r);

// Check database size
CALL dbms.queryJmx("org.neo4j:instance=kernel#0,name=Store sizes")
YIELD attributes
RETURN attributes;
```

#### Redis

```bash
# Connect to Redis
docker exec -it context-store-redis-prod redis-cli -a <REDIS_PASSWORD>

# Check memory usage
INFO memory

# Check key count
DBSIZE

# Check cache hit rate
INFO stats
```

### 4. Log Monitoring

Set up log aggregation (optional):

- **ELK Stack**: Elasticsearch, Logstash, Kibana
- **Grafana Loki**: Lightweight log aggregation
- **CloudWatch Logs**: AWS-managed logging

## Troubleshooting

### Common Issues

#### Issue: Container fails to start

**Symptoms**: Container exits immediately or shows "unhealthy" status

**Solutions**:
```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs <service>

# Check environment variables
docker-compose -f docker-compose.prod.yml config

# Verify port availability
sudo netstat -tulpn | grep <port>

# Restart service
docker-compose -f docker-compose.prod.yml restart <service>
```

#### Issue: Database connection fails

**Symptoms**: Application logs show connection errors

**Solutions**:
```bash
# Verify database is running
docker-compose -f docker-compose.prod.yml ps postgres

# Check database logs
docker-compose -f docker-compose.prod.yml logs postgres

# Test connection manually
docker exec -it context-store-postgres-prod psql -U context_store_user -d context_store

# Verify credentials in .env.production
cat .env.production | grep POSTGRES
```

#### Issue: High memory usage

**Symptoms**: System becomes slow, OOM errors

**Solutions**:
```bash
# Check memory usage
docker stats

# Adjust memory limits in docker-compose.prod.yml
# Restart services
docker-compose -f docker-compose.prod.yml restart

# Clear Redis cache
docker exec -it context-store-redis-prod redis-cli -a <password> FLUSHALL
```

#### Issue: Slow performance

**Symptoms**: High latency, timeouts

**Solutions**:
```bash
# Run performance benchmark
npm run benchmark

# Check database indexes
# PostgreSQL: \d+ <table_name>
# Neo4j: CALL db.indexes()

# Optimize queries
# Review slow query logs

# Scale resources
# Increase CPU/memory limits
```

### Debug Mode

Enable debug logging:

```bash
# Edit .env.production
LOG_LEVEL=debug

# Restart application
docker-compose -f docker-compose.prod.yml restart app
```

### Getting Help

1. Check logs: `docker-compose -f docker-compose.prod.yml logs`
2. Review [PRODUCTION_READINESS.md](./production-readiness.md)
3. Check [GitHub Issues](https://github.com/your-org/context-store-mcp/issues)
4. Contact support: support@example.com

## Rollback

If issues occur after deployment, rollback to the previous version:

### Quick Rollback

```bash
# Stop current deployment
docker-compose -f docker-compose.prod.yml down

# Restore previous version
docker-compose -f docker-compose.prod.yml up -d

# Verify rollback
docker-compose -f docker-compose.prod.yml ps
npm run health-check
```

### Database Rollback

If database changes were made:

```bash
# Restore PostgreSQL from backup
docker exec -i context-store-postgres-prod pg_restore \
  -U context_store_user -d context_store < backup.dump

# Restore Neo4j from backup
docker exec -i context-store-neo4j-prod neo4j-admin restore \
  --from=/backup/neo4j --database=neo4j
```

### Rollback Checklist

- [ ] Stop current deployment
- [ ] Restore previous Docker images
- [ ] Restore database from backup (if needed)
- [ ] Verify services are healthy
- [ ] Run smoke tests
- [ ] Monitor for issues
- [ ] Document rollback reason

## Maintenance

### Regular Tasks

#### Daily
- Monitor error logs
- Check disk usage
- Verify backups

#### Weekly
- Review performance metrics
- Update security patches
- Clean up old logs

#### Monthly
- Performance review
- Capacity planning
- Security audit
- Dependency updates

### Backup Schedule

```bash
# Daily backup (automated)
0 2 * * * /path/to/backup-script.sh

# Weekly full backup
0 3 * * 0 /path/to/full-backup-script.sh

# Monthly archive
0 4 1 * * /path/to/archive-script.sh
```

## Security Best Practices

1. **Use strong passwords** (min 16 characters)
2. **Enable TLS/SSL** for production
3. **Rotate secrets** every 90 days
4. **Keep dependencies updated**
5. **Monitor security advisories**
6. **Implement rate limiting**
7. **Use firewall rules**
8. **Enable audit logging**
9. **Regular security scans**
10. **Principle of least privilege**

## Support

For deployment support:

- **Documentation**: [docs/](../)
- **Issues**: [GitHub Issues](https://github.com/your-org/context-store-mcp/issues)
- **Email**: support@example.com
- **Slack**: #context-store-support

---

**Last Updated**: 2024-01-XX
**Version**: 1.0.0
