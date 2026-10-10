import { caseGateway } from '../../../../lib/case-gateway';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return caseGateway(request, path, {
    backend: process.env.PARALLAX_API_BASE_URL || '',
    origin: process.env.PARALLAX_PUBLIC_ORIGIN || '',
    secret: process.env.PARALLAX_GATEWAY_SECRET || '',
    runtime: process.env.PARALLAX_RUNTIME || 'local',
  });
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
