# Context Store MCP - Quick Start Guide

## 🚀 Deploy in 5 Minutes

### Prerequisites
- Docker 24.0+
- Docker Compose 2.20+
- Node.js 20.x LTS

### Quick Deploy

```bash
# 1. Clone repository
git clone https://github.com/your-org/context-store-mcp.git
cd context-store-mcp

# 2. Configure environment
cp .env.production.example .env.production
nano .env.production  # Edit with your values

# 3. Deploy
./scripts/deploy.sh
```

That's it! Your Context Store MCP is now running at http://localhost:3000

## 📋 Essential Configuration

Edit `.env.production` with these required values:

```bash
# Strong passwords (use: openssl rand -base64 32)
POSTGRES_PASSWORD=<your-strong-password>
NEO4J_PASSWORD=<your-strong-password>
REDIS_PASSWORD=<your-strong-password>

# OpenAI API Key
OPENAI_API_KEY=sk-<your-api-key>

# Security Secret (use: openssl rand -base64 32)
SIGNATURE_SECRET=<your-secret>
```

## 🔍 Verify Deployment

```bash
# Check services
docker-compose -f docker-compose.prod.yml ps

# Health check
curl http://localhost:3000/health

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

## 🛠️ Common Commands

```bash
# Start services
docker-compose -f docker-compose.prod.yml up -d

# Stop services
docker-compose -f docker-compose.prod.yml down

# Restart services
docker-compose -f docker-compose.prod.yml restart

# View logs
docker-compose -f docker-compose.prod.yml logs -f app

# Run benchmarks
npm run benchmark

# Security audit
npm run security-audit
```

## 📊 Default Ports

- **Application**: 3000
- **PostgreSQL**: 5432
- **Neo4j HTTP**: 7474
- **Neo4j Bolt**: 7687
- **Redis**: 6379

## 🔐 Security Checklist

- [ ] Strong passwords set (16+ characters)
- [ ] SIGNATURE_SECRET generated
- [ ] OPENAI_API_KEY configured
- [ ] Firewall rules configured
- [ ] TLS/SSL enabled (production)
- [ ] Backup strategy configured

## 📚 Documentation

- **Full Deployment Guide**: [DEPLOYMENT.md](./docs/deployment/guide.md)
- **Deployment Checklist**: [DEPLOYMENT_CHECKLIST.md](./docs/deployment/checklist.md)
- **Production Readiness**: [PRODUCTION_READINESS.md](./docs/deployment/production-readiness.md)
- **Deployment Summary**: [DEPLOYMENT_SUMMARY.md](./docs/archive/DEPLOYMENT_SUMMARY.md)

## 🆘 Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs <service>

# Verify environment
docker-compose -f docker-compose.prod.yml config
```

### Database connection fails
```bash
# Test PostgreSQL
docker exec -it context-store-postgres-prod psql -U context_store_user -d context_store

# Test Neo4j
curl http://localhost:7474

# Test Redis
docker exec -it context-store-redis-prod redis-cli -a <password> ping
```

### High resource usage
```bash
# Check resource usage
docker stats

# Adjust limits in docker-compose.prod.yml
# Then restart services
```

## 🎯 Performance Targets

- **P95 Latency**: < 2000ms ✓
- **Throughput**: 100+ req/sec
- **Availability**: 99.9% uptime

## 📞 Support

- **Issues**: GitHub Issues
- **Email**: support@example.com
- **Docs**: [docs/](./docs/)

---

**Ready to deploy?** Run `./scripts/deploy.sh` and you're live in minutes! 🎉
