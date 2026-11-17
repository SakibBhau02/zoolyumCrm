"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, Check, ChevronRight, CircleAlert, Sparkles, UserRound } from "lucide-react";
import { apiFetch, apiFetchFormData } from "@/lib/api";
import { Avatar, cn } from "@/components/shared";
import { Btn } from "@/components/table";
import { Field, Input, Modal, Select } from "@/components/ui";
import { DAYS, EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, dayShort, label } from "../constants";
import { usePeopleAccess } from "../permissions";

type Form = {
  name: string;
  roleTitle: string;
  department: string;
  joinDate: string;
  employmentType: string;
  employmentStatus: string;
  email: string;
  phone: string;
  workLocation: string;
  reportingManagerId: string;
  skillTags: string;
  salary: string;
  payFrequency: string;
  costRate: string;
  deviceId: string;
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: string;
  weeklyOffDays: string[];
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
};

type Lite = { id: string; name: string; roleTitle: string; department: string | null; email: string | null; deviceId?: string | null; employmentStatus?: string };

const DRAFT_KEY = "zoolyum:people:add-employee-draft";

const today = () => new Date().toISOString().slice(0, 10);

const blank = (keep?: Partial<Form>): Form => ({
  name: "",
  roleTitle: "",
  department: "",
  joinDate: today(),
  employmentType: "full-time",
  employmentStatus: "ACTIVE",
  email: "",
  phone: "",
  workLocation: "",
  reportingManagerId: "",
  skillTags: "",
  salary: "",
  payFrequency: "monthly",
  costRate: "",
  deviceId: "",
  shiftStart: "",
  shiftEnd: "",
  graceMinutes: "",
  weeklyOffDays: [],
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelation: "",
  ...keep,
});

const STEPS = [
  { key: "who", label: "Who", hint: "The basics" },
  { key: "job", label: "Job", hint: "Manager & contact" },
  { key: "pay", label: "Pay", hint: "Salary & schedule" },
] as const;

const prettyDate = (value: string) => {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Add employee — a three-step wizard with a live summary.
 *
 * The previous form put 21 fields in one scroll (1231px inside an 810px sheet),
 * marked nothing as required and only reported errors in a paragraph under the
 * form. HR-এর জন্য hire করা মাঝে মাঝে আসা কাজ, কিন্তু প্রতিবারই ২১ ফিল্ড স্ক্রল
 * করা মানে প্রতিবারই ধীর। তিন ধাপে ভাগ করা হয়েছে যাতে প্রথম ধাপেই (৪টি ফিল্ড)
 * employee তৈরি করা যায়; বাকিটা পরে প্রোফাইল থেকে পূরণ করা যায়। NN/g-এর
 * wizard guidance অনুযায়ী ধাপের ক্রম বাধ্যতামূলক, step indicator সবসময় দেখা যায়,
 * আর draft autosave করা হয় যাতে মাঝপথে বন্ধ করলেও কাজ না হারায়।
 */
export function EmployeeModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (employee?: any) => void;
}) {
  const router = useRouter();
  const { canSeePay } = usePeopleAccess();

  const steps = canSeePay ? STEPS : STEPS.slice(0, 2);
  const lastStep = steps.length - 1;

  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(blank);
  const [employees, setEmployees] = useState<Lite[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [managerQ, setManagerQ] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset on open, restoring an unfinished draft instead of silently throwing
  // away what somebody typed before the modal was closed.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setCreated(null);
    setErrors({});
    setBanner(null);
    setBusy(false);
    setPhoto(null);
    setManagerQ("");
    let draft: Partial<Form> | null = null;
    try {
      draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    } catch {
      draft = null;
    }
    const usable = draft && (draft.name || draft.roleTitle);
    setF(usable ? blank(draft ?? undefined) : blank());
    setDraftRestored(!!usable);
    apiFetch<Lite[]>("/people/employees")
      .then((rows) => setEmployees((rows ?? []).map((e) => ({ id: e.id, name: e.name, roleTitle: e.roleTitle, department: e.department, email: e.email, deviceId: (e as any).deviceId, employmentStatus: (e as any).employmentStatus }))))
      .catch(() => setEmployees([]));
  }, [open]);

  // Draft autosave (local only — nothing is created until the user submits).
  useEffect(() => {
    if (!open || created) return;
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(f));
      } catch {
        /* storage full / private mode — the form still works */
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [f, open, created]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setF((prev) => ({ ...prev, [key]: value }));

  const setPhotoFile = (file: File | null) => {
    if (photo) URL.revokeObjectURL(photo.url);
    if (!file) {
      setPhoto(null);
      return;
    }
    if (!/^image\//.test(file.type)) {
      setErrors((e) => ({ ...e, photo: "Pick an image file (JPG, PNG or WebP)" }));
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setErrors((e) => ({ ...e, photo: "Image must be under 6 MB" }));
      return;
    }
    setErrors((e) => ({ ...e, photo: "" }));
    setPhoto({ file, url: URL.createObjectURL(file) });
  };

  const skills = useMemo(() => f.skillTags.split(",").map((s) => s.trim()).filter(Boolean), [f.skillTags]);
  const managers = useMemo(() => {
    const q = managerQ.trim().toLowerCase();
    return employees
      .filter((e) => e.employmentStatus !== "EXITED")
      .filter((e) => !q || `${e.name} ${e.roleTitle}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [employees, managerQ]);

  const duplicate = useMemo(() => {
    const email = f.email.trim().toLowerCase();
    const device = f.deviceId.trim();
    const name = f.name.trim().toLowerCase();
    return (
      employees.find(
        (e) =>
          (email && String(e.email ?? "").toLowerCase() === email) ||
          (device && String(e.deviceId ?? "") === device) ||
          (name.length > 2 && e.name.trim().toLowerCase() === name),
      ) ?? null
    );
  }, [employees, f.email, f.deviceId, f.name]);

  /** Field-level validation — never a single paragraph at the bottom. */
  const validate = (upto: number) => {
    const next: Record<string, string> = {};
    if (upto >= 0) {
      if (!f.name.trim()) next.name = "Name is required";
      if (!f.roleTitle.trim()) next.roleTitle = "Role is required";
      if (!f.department.trim()) next.department = "Department is required";
      if (!f.joinDate) next.joinDate = "Join date is required";
      else if (Number.isNaN(new Date(f.joinDate).getTime())) next.joinDate = "Use a valid date";
      if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) next.email = "That email doesn't look right";
    }
    if (upto >= 1) {
      if (f.phone.trim() && f.phone.replace(/[^\d]/g, "").length < 7) next.phone = "Phone looks too short";
    }
    if (upto >= 2 && canSeePay) {
      if (f.salary !== "" && Number(f.salary) < 0) next.salary = "Salary cannot be negative";
      if (f.graceMinutes !== "" && (Number(f.graceMinutes) < 0 || Number(f.graceMinutes) > 120)) next.graceMinutes = "0–120 minutes";
      if (f.deviceId.trim() && duplicate && String(duplicate.deviceId ?? "") === f.deviceId.trim()) next.deviceId = "This device ID is already assigned";
    }
    return next;
  };

  /** Validate every step, jump to the first one that still has an error. */
  const createValidated = () => {
    const next = validate(lastStep);
    setErrors(next);
    if (Object.keys(next).length) {
      const first = ["name", "roleTitle", "department", "joinDate"].some((k) => next[k])
        ? 0
        : next.email || next.phone
          ? 1
          : 2;
      setStep(Math.min(first, lastStep));
      return;
    }
    void create();
  };

  const goNext = () => {
    const next = validate(step);
    setErrors(next);
    if (Object.keys(next).length) return;
    if (step < lastStep) setStep(step + 1);
    else createValidated();
  };

  const saveNow = () => {
    const next = validate(0);
    // Quick-save still respects the one field that can poison later reports.
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
      next.email = "That email doesn't look right";
      setErrors(next);
      setStep(1);
      return;
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    void create();
  };

  const create = async () => {
    setBusy(true);
    setBanner(null);
    const body: Record<string, any> = {
      name: f.name.trim(),
      roleTitle: f.roleTitle.trim(),
      department: f.department.trim(),
      joinDate: f.joinDate,
      employmentType: f.employmentType,
      employmentStatus: f.employmentStatus,
      email: f.email.trim() || undefined,
      phone: f.phone.trim() || undefined,
      workLocation: f.workLocation.trim() || undefined,
      reportingManagerId: f.reportingManagerId || undefined,
      skillTags: skills,
    };
    if (canSeePay) {
      if (f.salary !== "") body.salary = Number(f.salary);
      if (f.costRate !== "") body.costRate = Number(f.costRate);
      body.payFrequency = f.payFrequency;
      if (f.deviceId.trim()) body.deviceId = f.deviceId.trim();
      if (f.shiftStart) body.shiftStart = f.shiftStart;
      if (f.shiftEnd) body.shiftEnd = f.shiftEnd;
      if (f.graceMinutes !== "") body.graceMinutes = Number(f.graceMinutes);
      if (f.weeklyOffDays.length) body.weeklyOffDays = f.weeklyOffDays;
      if (f.emergencyContactName.trim()) body.emergencyContactName = f.emergencyContactName.trim();
      if (f.emergencyContactPhone.trim()) body.emergencyContactPhone = f.emergencyContactPhone.trim();
      if (f.emergencyContactRelation.trim()) body.emergencyContactRelation = f.emergencyContactRelation.trim();
    }
    try {
      const employee = await apiFetch<any>("/people/employees", { method: "POST", body: JSON.stringify(body) });
      // The record exists at this point. A failed photo must not look like a
      // failed hire, so it is reported as a soft warning on the success card.
      if (photo?.file && employee?.id) {
        try {
          const fd = new FormData();
          fd.append("file", photo.file);
          await apiFetchFormData(`/people/employees/${employee.id}/photo`, fd);
        } catch {
          setBanner("Employee created, but the photo upload failed — add it from their profile.");
        }
      }
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}
      setCreated(employee);
      onSaved(employee);
    } catch (e: any) {
      setBanner(e?.message ?? "Could not create the employee");
    } finally {
      setBusy(false);
    }
  };

  const addAnother = () => {
    // Keep department + location — HR usually hires several people into the
    // same team in one sitting.
    setF(blank({ department: f.department, workLocation: f.workLocation, employmentStatus: f.employmentStatus }));
    setStep(0);
    setCreated(null);
    setPhoto(null);
    setErrors({});
    setBanner(null);
    setDraftRestored(false);
  };

  const finish = () => {
    onClose();
  };

  const openProfile = () => {
    if (created?.id) router.push(`/people/directory/${created.id}`);
    onClose();
  };

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    setF(blank());
    setDraftRestored(false);
    setErrors({});
  };

  const summaryName = f.name.trim() || "New employee";
  const summaryRole = [f.roleTitle.trim(), f.department.trim()].filter(Boolean).join(" · ") || "Role and department";

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={false}
      title={created ? "Employee created" : "Add employee"}
      subtitle={
        created
          ? "The profile and onboarding checklist are ready."
          : step === 0
            ? "Four required fields — everything else can be finished later."
            : "Optional — skip anything you don't know yet."
      }
      size="2xl"
      footer={
        created ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button onClick={addAnother} className="text-meta font-semibold text-muted-foreground hover:text-foreground">
              Add another
            </button>
            <div className="flex items-center gap-2">
              <Btn onClick={openProfile} variant="outline">Open profile</Btn>
              <Btn onClick={finish} variant="primary">Done</Btn>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className={cn("inline-flex items-center gap-1 text-meta font-semibold", step === 0 ? "cursor-not-allowed text-muted-foreground/40" : "text-muted-foreground hover:text-foreground")}
            >
              <ArrowLeft className="size-3.5" /> Back
            </button>
            <div className="flex items-center gap-2">
              <span className="text-micro text-muted-foreground">
                {step + 1}/{steps.length}
                <span className="hidden sm:inline"> · {steps[step].label}</span>
              </span>
              {step === 0 && (
                <Btn onClick={saveNow} disabled={busy}>Save now</Btn>
              )}
              <Btn variant="primary" onClick={goNext} disabled={busy} type="button">
                {busy ? "Saving…" : step === lastStep ? "Create employee" : "Continue"}
                {!busy && step < lastStep && <ChevronRight className="size-3.5" />}
              </Btn>
            </div>
          </div>
        )
      }
    >
      {created ? (
        <SuccessCard employee={created} photoUrl={photo?.url} banner={banner} />
      ) : (
        <div
          className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]"
          onKeyDown={(e) => {
            // Enter advances the wizard (Shift+Enter keeps the browser default);
            // Ctrl/Cmd+Enter creates from anywhere.
            if (e.key !== "Enter" || e.shiftKey) return;
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "BUTTON" || tag === "TEXTAREA" || tag === "SELECT") return;
            e.preventDefault();
            if (e.metaKey || e.ctrlKey) createValidated();
            else goNext();
          }}
        >
          <div className="flex min-w-0 flex-col gap-3">
            <StepRail steps={steps} current={step} onJump={(i) => i < step && setStep(i)} />

            {draftRestored && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-700 dark:text-amber-300">
                <span>Draft restored from your last visit.</span>
                <button onClick={clearDraft} className="font-bold hover:underline">Start fresh</button>
              </div>
            )}

            {banner && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-meta font-medium text-rose-600 dark:text-rose-300">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {banner}
              </div>
            )}

            {step === 0 && (
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Full name" required error={errors.name}>
                  <Input
                    value={f.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="e.g. Rahim Ahmed"
                    autoFocus
                    aria-invalid={!!errors.name}
                  />
                </Field>
                <Field label="Role / title" required error={errors.roleTitle}>
                  <Input
                    value={f.roleTitle}
                    onChange={(e) => set("roleTitle", e.target.value)}
                    placeholder="e.g. Software Engineer"
                    aria-invalid={!!errors.roleTitle}
                  />
                </Field>
                <Field label="Department" required error={errors.department} hint="Drives the org chart and task-type rules.">
                  <Input
                    value={f.department}
                    onChange={(e) => set("department", e.target.value)}
                    placeholder="e.g. Engineering"
                    aria-invalid={!!errors.department}
                  />
                </Field>
                <Field label="Joined date" required error={errors.joinDate}>
                  <Input type="date" value={f.joinDate} onChange={(e) => set("joinDate", e.target.value)} aria-invalid={!!errors.joinDate} />
                </Field>
                <Field label="Employment type">
                  <Select value={f.employmentType} onChange={(e) => set("employmentType", e.target.value)}>
                    {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                  </Select>
                </Field>
                <Field label="Photo" error={errors.photo}>
                  <div className="flex items-center gap-2">
                    {photo ? (
                      <img src={photo.url} alt="Selected photo preview" className="size-10 rounded-full object-cover ring-2 ring-border" />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <UserRound className="size-4" />
                      </span>
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                    />
                    <Btn onClick={() => fileRef.current?.click()}>
                      <Camera className="size-3.5" /> {photo ? "Change" : "Upload"}
                    </Btn>
                    {photo && (
                      <button onClick={() => setPhotoFile(null)} className="text-meta text-muted-foreground hover:text-rose-500">Remove</button>
                    )}
                  </div>
                </Field>
                {duplicate && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-700 dark:text-amber-300 sm:col-span-2">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      This looks like an existing record: <strong>{duplicate.name}</strong> · {duplicate.roleTitle}. You can still continue if it is a different person.
                    </span>
                  </div>
                )}
              </section>
            )}

            {step === 1 && (
              <section className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Reporting manager" hint="Search by name or role.">
                    <div className="flex flex-col gap-1.5">
                      <Input value={managerQ} onChange={(e) => setManagerQ(e.target.value)} placeholder="Search managers…" />
                      <Select value={f.reportingManagerId} onChange={(e) => set("reportingManagerId", e.target.value)}>
                        <option value="">No manager</option>
                        {managers.map((m) => (
                          <option key={m.id} value={m.id}>{m.name} · {m.roleTitle}</option>
                        ))}
                      </Select>
                    </div>
                  </Field>
                  <Field label="Work location" hint="Office, remote, or hybrid.">
                    <Input value={f.workLocation} onChange={(e) => set("workLocation", e.target.value)} placeholder="e.g. Remote / Dhaka office" />
                  </Field>
                  <Field label="Email" error={errors.email}>
                    <Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="name@company.com" aria-invalid={!!errors.email} />
                  </Field>
                  <Field label="Phone" error={errors.phone}>
                    <Input value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+8801…" aria-invalid={!!errors.phone} />
                  </Field>
                  <Field label="Employment status" hint="EXITED starts the offboarding checklist.">
                    <Select value={f.employmentStatus} onChange={(e) => set("employmentStatus", e.target.value)}>
                      {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                    </Select>
                  </Field>
                  <Field label="Skills" hint="Comma separated — powers the skills matrix.">
                    <Input value={f.skillTags} onChange={(e) => set("skillTags", e.target.value)} placeholder="e.g. react, figma, video editing" />
                  </Field>
                </div>
                {!!skills.length && (
                  <div className="flex flex-wrap gap-1">
                    {skills.map((s) => (
                      <span key={s} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-micro font-semibold text-muted-foreground">{s}</span>
                    ))}
                  </div>
                )}
              </section>
            )}

            {step === 2 && canSeePay && (
              <section className="flex flex-col gap-3">
                <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-micro text-muted-foreground">
                  These details are HR-only. Leave anything blank to inherit the company attendance policy — you can complete it later from the profile.
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Monthly salary (BDT)" error={errors.salary}>
                    <Input type="number" min={0} value={f.salary} onChange={(e) => set("salary", e.target.value)} placeholder="e.g. 65000" aria-invalid={!!errors.salary} />
                  </Field>
                  <Field label="Pay frequency">
                    <Select value={f.payFrequency} onChange={(e) => set("payFrequency", e.target.value)}>
                      <option value="monthly">Monthly</option>
                      <option value="weekly">Weekly</option>
                      <option value="daily">Daily</option>
                      <option value="hourly">Hourly</option>
                    </Select>
                  </Field>
                  <Field label="Cost rate (per hour)">
                    <Input type="number" min={0} value={f.costRate} onChange={(e) => set("costRate", e.target.value)} placeholder="Optional" />
                  </Field>
                  <Field label="Device ID (fingerprint)" error={errors.deviceId} hint="Must be unique across the company.">
                    <Input value={f.deviceId} onChange={(e) => set("deviceId", e.target.value)} placeholder="e.g. 101" aria-invalid={!!errors.deviceId} />
                  </Field>
                  <Field label="Shift start">
                    <Input type="time" value={f.shiftStart} onChange={(e) => set("shiftStart", e.target.value)} />
                  </Field>
                  <Field label="Shift end">
                    <Input type="time" value={f.shiftEnd} onChange={(e) => set("shiftEnd", e.target.value)} />
                  </Field>
                  <Field label="Grace minutes" error={errors.graceMinutes}>
                    <Input type="number" min={0} max={120} value={f.graceMinutes} onChange={(e) => set("graceMinutes", e.target.value)} placeholder="e.g. 10" aria-invalid={!!errors.graceMinutes} />
                  </Field>
                  <Field label="Weekly off days" className="sm:col-span-2">
                    <div className="flex flex-wrap gap-1.5">
                      {DAYS.map((d) => {
                        const on = f.weeklyOffDays.includes(d);
                        return (
                          <button
                            type="button"
                            key={d}
                            onClick={() =>
                              set("weeklyOffDays", on ? f.weeklyOffDays.filter((x) => x !== d) : [...f.weeklyOffDays, d])
                            }
                            aria-pressed={on}
                            className={cn(
                              "rounded-lg border px-2.5 py-1 text-micro font-semibold transition-colors",
                              on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {dayShort[d]}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                  <Field label="Emergency contact">
                    <Input value={f.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} placeholder="Full name" />
                  </Field>
                  <Field label="Emergency phone">
                    <Input value={f.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone", e.target.value)} placeholder="+8801…" />
                  </Field>
                  <Field label="Relationship">
                    <Input value={f.emergencyContactRelation} onChange={(e) => set("emergencyContactRelation", e.target.value)} placeholder="Spouse / Parent" />
                  </Field>
                </div>
              </section>
            )}
          </div>

          {/* Live summary: what will be created, visible the whole time. */}
          <aside className="hidden lg:block">
            <div className="sticky top-0 flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/25 p-3">
              <div className="flex items-center gap-2">
                {photo ? (
                  <img src={photo.url} alt="" className="size-9 rounded-full object-cover" />
                ) : (
                  <Avatar name={summaryName} size="size-9" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold">{summaryName}</p>
                  <p className="truncate text-micro text-muted-foreground">{summaryRole}</p>
                </div>
              </div>
              <dl className="flex flex-col gap-1.5 text-meta">
                <SummaryRow label="Joined" value={prettyDate(f.joinDate)} />
                <SummaryRow label="Type" value={titleCase(label(f.employmentType))} />
                <SummaryRow label="Status" value={titleCase(label(f.employmentStatus))} />
                <SummaryRow label="Manager" value={employees.find((e) => e.id === f.reportingManagerId)?.name ?? "—"} />
                <SummaryRow label="Location" value={f.workLocation.trim() || "—"} />
                {canSeePay && <SummaryRow label="Salary" value={f.salary ? `৳${Number(f.salary).toLocaleString("en-US")}` : "—"} />}
              </dl>
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-2">
                <p className="flex items-center gap-1 text-micro font-bold uppercase tracking-wide text-primary">
                  <Sparkles className="size-3" /> On next
                </p>
                <p className="mt-0.5 text-micro leading-snug text-muted-foreground">
                  Profile page, 8-step onboarding checklist, and the directory entry. Login can be linked later from Control → Users.
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </Modal>
  );
}

function SummaryRow({ label: l, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{l}</dt>
      <dd className="max-w-[150px] truncate text-right font-medium">{value}</dd>
    </div>
  );
}

function StepRail({ steps, current, onJump }: { steps: readonly { label: string; hint: string }[]; current: number; onJump: (i: number) => void }) {
  return (
    <ol className="flex items-center gap-1.5">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.label} className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onJump(i)}
              disabled={!done}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition-colors",
                active ? "border-primary/40 bg-primary/5" : done ? "border-border bg-card hover:bg-muted/50" : "border-border/60 bg-transparent",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-micro font-bold tabular-nums",
                  active ? "bg-primary text-white" : done ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate text-meta font-semibold", active ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
                <span className="hidden truncate text-micro text-muted-foreground sm:block">{s.hint}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function SuccessCard({ employee, photoUrl, banner }: { employee: any; photoUrl?: string; banner: string | null }) {
  return (
    <div className="flex flex-col items-center gap-3 py-3 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Check className="size-5" />
      </span>
      <div className="flex items-center gap-2">
        {photoUrl ? (
          <img src={photoUrl} alt="" className="size-9 rounded-full object-cover" />
        ) : (
          <Avatar name={employee?.name ?? "New"} size="size-9" />
        )}
        <div className="text-left">
          <p className="text-body-lg font-semibold">{employee?.name}</p>
          <p className="text-meta text-muted-foreground">
            {[employee?.roleTitle, employee?.department].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <p className="max-w-sm text-meta text-muted-foreground">
        Onboarding checklist created with 8 steps (HR, IT, Finance, Manager). Assign a login from Control → Users when the email is ready.
      </p>
      {banner && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-meta text-amber-700 dark:text-amber-300">{banner}</p>
      )}
    </div>
  );
}
