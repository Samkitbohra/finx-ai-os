import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireCtx } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { ActionForm, Field, Select } from '@/components/form';
import { LANGUAGES } from '@/server/agent';
import { createBorrowerAction } from '../../actions';

export const metadata = { title: 'New borrower' };

export default async function NewBorrower() {
  const ctx = await requireCtx('borrower.write');
  const branches = await db.select().from(schema.branches).where(eq(schema.branches.orgId, ctx.orgId)).orderBy(asc(schema.branches.code));
  return (
    <>
      <PageHeader back={{ href: '/console/borrowers', label: 'Borrowers' }} title="New borrower" sub="KYC details, language and contact consent. Only the last four digits of Aadhaar are stored." />
      <ActionForm action={createBorrowerAction} className="card space-y-6 p-6" submit="Create borrower">
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold">Identity</legend>
          <Field label="Full name" name="name" required />
          <Field label="Father / spouse name" name="fatherName" />
          <Field label="Date of birth" name="dob" type="date" />
          <Select label="Gender" name="gender" options={[['', '—'], ['F', 'Female'], ['M', 'Male'], ['O', 'Other']]} />
          <Field label="PAN" name="pan" placeholder="ABCDE1234F" />
          <Field label="Aadhaar (last 4 digits)" name="aadhaarLast4" placeholder="1234" />
          <Field label="CKYC number" name="ckycNo" />
          <Field label="Occupation" name="occupation" />
          <Field label="Monthly income (₹)" name="monthlyIncome" type="number" />
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold">Contact</legend>
          <Field label="Mobile" name="phone" required placeholder="+91 98400 12345" />
          <Field label="Alternate mobile" name="altPhone" />
          <Field label="Email" name="email" type="email" />
          <Field label="Address" name="address" className="sm:col-span-2" />
          <Field label="City" name="city" defaultValue="Chennai" />
          <Field label="State" name="state" defaultValue="Tamil Nadu" />
          <Field label="PIN code" name="pincode" />
          <Select label="Branch" name="branchId" options={branches.map((b) => [b.id, `${b.code} · ${b.name}`])} defaultValue={ctx.branchId} />
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Language and consent</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Preferred language" name="language" options={Object.entries(LANGUAGES)} defaultValue="ta" />
          </div>
          <p className="mb-2 mt-4 text-sm text-dim">The borrower agrees to be contacted about this loan on:</p>
          <div className="flex flex-wrap gap-4 text-sm">
            {[['VOICE', 'Phone calls'], ['WHATSAPP', 'WhatsApp'], ['SMS', 'SMS'], ['EMAIL', 'Email']].map(([v, l]) => (
              <label key={v} className="flex items-center gap-2"><input type="checkbox" name="consent" value={v} defaultChecked={v !== 'EMAIL'} />{l}</label>
            ))}
          </div>
          <p className="mt-2 text-xs text-mute">Consent is recorded with today’s date. The agent will not use a channel without it.</p>
        </fieldset>
      </ActionForm>
    </>
  );
}
