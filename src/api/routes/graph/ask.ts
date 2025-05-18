import { FastifyInstance } from 'fastify';

export default async function askEndpoint(fastify: FastifyInstance) {
  // GET /api/graph/laws - List all laws
  fastify.get('/ask', {
    schema: {//you can change the code here in this file to fit the logic ,this just a test call api
      description: 'Get a list of all laws',
      tags: ['graph'],
      response: {
        200: {
          description: 'Successful response',
          type: 'object',
          properties: {
            laws: { 
              type: 'array', 
              items: { 
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  effectiveDate: { type: 'string' },
                }
              } 
            }
          }
        },
        500: {
          description: 'Error response',
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      // Sample data for testing
      const sampleLaws = [
        {
          id: 'CZ-2020-1',
          title: 'Zákon o kybernetické bezpečnosti',
          effectiveDate: '2020-01-01'
        },
        {
          id: 'CZ-2021-42',
          title: 'Zákon o ochraně osobních údajů',
          effectiveDate: '2021-05-15'
        },
        {
          id: 'CZ-2019-87',
          title: 'Občanský zákoník',
          effectiveDate: '2019-03-01'
        }
      ];

      return { laws: sampleLaws };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: 'Internal Server Error' });
    }
  });
}