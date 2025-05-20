import { FastifyInstance } from 'fastify';
import askEndpoint from './ask';


export default async function graphRoutes(fastify: FastifyInstance) {
  await fastify.register(askEndpoint);
}