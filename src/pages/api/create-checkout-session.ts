import { handleError, initBaseAuth } from '@propelauth/node';
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';

import { db } from '../../db/db';
import { orgStripeCustomerMappings } from '../../db/schema';
import { getStripeConfig, openStripe } from '../../lib/stripe';
import { serverEnv } from '../../t3-env';

export const prerender = false;

export const post: APIRoute = async ({ request }) => {
	const propelauth = initBaseAuth({
		authUrl: serverEnv.PUBLIC_AUTH_URL,
		apiKey: serverEnv.PROPELAUTH_API_KEY,
		manualTokenVerificationMetadata: {
			verifierKey: serverEnv.PROPELAUTH_VERIFIER_KEY,
			issuer: serverEnv.PUBLIC_AUTH_URL,
		},
	});

	const token = request.headers.get('Authorization');

	try {
		const stripeConfig = getStripeConfig();
		if (!stripeConfig) {
			throw new Error('Stripe secret key and price ID are not configured');
		}

		if (!token) {
			throw new Error('No token');
		}

		const { orgId } = await request.json();

		if (!orgId) {
			throw new Error('No orgId');
		}

		// make sure we have access to org
		await propelauth.validateAccessTokenAndGetUserWithOrgInfo(token, { orgId });

		const mappings = await db
			.select()
			.from(orgStripeCustomerMappings)
			.where(eq(orgStripeCustomerMappings.orgId, orgId));

		const customerId = mappings[0]?.stripeCustomerId;

		const stripe = openStripe(stripeConfig);
		const app_url = new URL(request.url).origin + '/app/settings';
		const session = await stripe.checkout.sessions.create({
			client_reference_id: orgId,
			customer: customerId,
			line_items: [
				{
					price: stripeConfig.priceId,
					quantity: 1,
				},
			],
			mode: 'subscription',
			success_url: app_url,
			cancel_url: app_url,
		});

		const { url } = session;

		if (!url) {
			throw new Error('No checkout URL');
		}

		return new Response(JSON.stringify({ url }));
	} catch (e) {
		const err = handleError(e, { logError: true, returnDetailedErrorToUser: false });
		return new Response(err.message, { status: err.status });
	}
};