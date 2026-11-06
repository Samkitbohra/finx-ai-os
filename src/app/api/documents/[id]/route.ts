import { NextResponse } from 'next/server';
import { getCtx } from '@/lib/auth';
import { getFile } from '@/server/documents';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
  const f = await getFile(ctx, (await params).id);
  if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let body: Buffer | string = f.data;
  // Show the seal (signature, hash check, tamper log) on generated HTML documents
  if (f.doc.mime === 'text/html') {
    const seal = `<div style="margin:32px auto;max-width:760px;padding:16px 20px;border:1px solid #ccc;border-radius:10px;font:13px Helvetica,Arial,sans-serif">
<b>${f.intact ? '✓ Document intact' : '⚠ Document has changed since it was filed'}</b> · SHA-256 ${f.doc.sha256.slice(0, 16)}…
${f.doc.signature ? `<div style="margin-top:10px">Signed by ${f.doc.signerName} on ${f.doc.signedAt?.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}<br><img src="${f.doc.signature}" style="height:70px;margin-top:6px"/></div>` : ''}
<ol style="margin:10px 0 0;color:#555">${f.doc.tamperLog.map((t) => `<li>${new Date(t.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} — ${t.action}${t.by ? ` (${t.by})` : ''}</li>`).join('')}</ol></div>`;
    body = f.data.toString('utf8').replace('</body>', `${seal}</body>`);
  }
  return new NextResponse(body as BodyInit, { headers: { 'Content-Type': f.doc.mime, 'Content-Disposition': `${f.doc.mime === 'text/html' || f.doc.mime.startsWith('image/') || f.doc.mime === 'application/pdf' ? 'inline' : 'attachment'}; filename="${f.doc.filename}"`, 'Cache-Control': 'private, no-store' } });
}
