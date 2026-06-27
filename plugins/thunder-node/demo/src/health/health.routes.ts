import { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({ status: 'ok' }));
  fastify.get('/health/ready', async () => ({ ready: true }));
}
