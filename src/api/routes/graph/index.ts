import { FastifyInstance } from 'fastify';
import askEndpoint from './ask';
import searchEndpoint from './search';

export default async function graphRoutes(fastify: FastifyInstance) {
  await fastify.register(askEndpoint);
  await fastify.register(searchEndpoint);
}