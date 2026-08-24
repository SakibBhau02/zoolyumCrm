import { redirect } from "next/navigation";

export default async function OldPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/people/payroll/payslip/${id}`);
}