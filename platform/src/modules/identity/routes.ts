import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authProviderEnum, platformEnum } from '../apps/schema.js';
import { authOf, requireAuth } from './auth.js';
import { issueNonce } from './nonce.js';
import { signInWithGoogle } from './provider-sign-in.js';
import { mergeStrategyEnum } from './schema.js';
import { getMe, logout, refreshSession, signUpAnonymous } from './service.js';
import { publicJwks } from './tokens.js';
import { requestAccountDeletion } from './deletion.js';

const anonymousSignUpBody = z.object({
  appId: z.uuid(),
  installationId: z.uuid(),
  platform: z.enum(platformEnum.enumValues),
  appVersion: z.string().min(1).max(32),
  appBuild: z.string().min(1).max(32),
  osVersion: z.string().min(1).max(64),
});

const refreshBody = z.object({
  refreshToken: z.string().min(20).max(200),
});

const googleSignInBody = z.object({
  idToken: z.string().min(1).max(4096),
  // Omitted on the first attempt; set when retrying after 409 account_exists
  mergeStrategy: z.enum(mergeStrategyEnum.enumValues).optional(),
});

const tokenPairResponse = z.object({
  userId: z.uuid(),
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
});

const providerSignInResponse = z.object({
  result: z.enum(['linked', 'already_linked', 'signed_in']),
  userId: z.uuid(),
  tokens: tokenPairResponse.nullable(),
});

const nonceResponse = z.object({
  nonce: z.string(),
  expiresAt: z.iso.datetime(),
});

const meResponse = z.object({
  userId: z.uuid(),
  appId: z.uuid(),
  installationId: z.uuid(),
  platform: z.enum(platformEnum.enumValues),
  createdAt: z.iso.datetime(),
  providers: z.array(
    z.object({
      provider: z.enum(authProviderEnum.enumValues),
      email: z.string().nullable(),
    }),
  ),
});

export const identityRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public keys for verifying access tokens, used by app backends.
  // Cached for an hour: keys change rarely and old ones stay listed during rotation.
  app.get('/.well-known/jwks.json', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=3600');
    return { keys: publicJwks };
  });

  // First launch of an installation: create an anonymous user and issue tokens
  app.post(
    '/v1/auth/anonymous',
    {
      schema: {
        body: anonymousSignUpBody,
        response: { 201: tokenPairResponse },
      },
      // Per IP, to stop mass creation of accounts
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const tokens = await signUpAnonymous(request.body);
      return reply.code(201).send(tokens);
    },
  );

  // Exchange a refresh token for a new token pair
  app.post(
    '/v1/auth/refresh',
    {
      schema: {
        body: refreshBody,
        response: { 200: tokenPairResponse },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request) => refreshSession(request.body.refreshToken),
  );

  // One-time nonce for Google / Apple sign-in on this installation
  app.post(
    '/v1/auth/nonce',
    {
      preHandler: requireAuth,
      schema: { response: { 200: nonceResponse } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request) => issueNonce(authOf(request).installationId),
  );

  // Link a Google account, or sign this device into the user who owns it
  app.post(
    '/v1/auth/google',
    {
      preHandler: requireAuth,
      schema: {
        body: googleSignInBody,
        response: { 200: providerSignInResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) =>
      signInWithGoogle(authOf(request), request.body.idToken, request.body.mergeStrategy),
  );

  // Sign out on this device; returns tokens of a fresh anonymous user
  app.post(
    '/v1/auth/logout',
    {
      preHandler: requireAuth,
      schema: { response: { 200: tokenPairResponse } },
    },
    async (request) => logout(authOf(request)),
  );

  // The current user: id, device and linked sign-in methods
  app.get(
    '/v1/me',
    {
      preHandler: requireAuth,
      schema: { response: { 200: meResponse } },
    },
    async (request) => getMe(authOf(request)),
  );

  // Deletes the account; the device continues with a fresh anonymous user
  app.delete(
    '/v1/me',
    {
      preHandler: requireAuth,
      schema: { response: { 200: tokenPairResponse } },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request) => requestAccountDeletion(authOf(request)),
  );
};