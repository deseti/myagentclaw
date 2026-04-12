/**
 * auth.middleware.js
 * Re-export authenticate decorator sebagai preHandler hook
 * yang bisa di-reuse di semua protected routes.
 */

export const authenticate = async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Unauthorized', message: 'Token tidak valid atau sudah expired' });
  }
};
