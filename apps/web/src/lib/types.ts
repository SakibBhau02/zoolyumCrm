export interface DashboardOverview {
  generatedAt: string;
  pulse: {
    totalLeads: number;
    activeLeads: number;
    pipelineValue: number;
    weightedForecast: number;
    won: number;
    lost: number;
    hotLeads: number;
    staleLeads: number;
    leadsByStage: { stage: string; count: number; value: number }[];
  };
  accounts: {
    totalClients: number;
    avgHealth: number;
    health: { GREEN: number; YELLOW: number; RED: number };
    renewalsNext30: number;
  };
  flow: {
    totalProjects: number;
    activeProjects: number;
    healthStatusCounts: { ON_TRACK: number; AT_RISK: number; DELAYED: number };
    avgRisk: number;
    onTimeRate: number | null;
    atRisk: { id: string; name: string; healthStatus: string; riskScore: number | null; riskDriver: string | null }[];
  };
  tasks: {
    openTasks: number;
    dueToday: number;
    overdue: number;
    blocked: number;
    hoursThisWeek: number;
    highPriority: { id: string; title: string; priority: string; dueDate: string | null; status: string }[];
  };
  people: {
    totalEmployees: number;
    presentToday: number;
    onLeaveToday: number;
    avgUtilization: number;
    overloaded: number;
  };
  capital: {
    totalInvoiced: number;
    recognizedRevenue: number;
    collected: number;
    outstanding: number;
    overdueAmount: number;
    expensesMonth: number;
    pendingExpenses: number;
    cashPosition: number;
    paymentSplit: { method: string; amount: number }[];
    revenueTrend: { month: string; invoiced: number; collected: number; expenses: number }[];
    overdueInvoices: { id: string; invoiceNumber: string; dueDate: string | null; amount: number }[];
  };
  insight: {
    insights: { id: string; description: string; confidenceLevel: number | null; surfacedAt: string }[];
  };
  recentActivity: { id: string; text: string; at: string; kind: string }[];
  topClients: { id: string; companyName: string; revenue: number; healthLevel: string; healthScore: number | null }[];
}

export interface Lead {
  id: string;
  name: string;
  company: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  source: string;
  vertical: string;
  temperature: string;
  leadCategoryId?: string | null;
  leadCategory?: LeadCategory | null;
  probability: number | null;
  starred: boolean;
  tags: string[];
  website: string | null;
  pageLink: string | null;
  uid: string | null;
  stage: string;
  priority: string;
  leadScore: number | null;
  /** Rule-engine flags: NO_PHONE, NO_COMPANY, DUPLICATE, STALE, SLA_BREACH, UNASSIGNED. */
  qualityFlags?: string[];
  estimatedDealSize: number | null;
  currency: string;
  assignedTo: { id: string; name: string } | null;
  assignedToId?: string | null;
  convertedClientId?: string | null;
  client?: { id: string; companyName: string } | null;
  projects?: { id: string; name: string; status: string; team?: string[]; assignedPm?: { name: string } | null }[];
  /** What the lead needs — sector, requirement, budget, timeline. */
  description?: string | null;
  notes?: string | null;
  createdAt: string;
  stageEnteredAt?: string | null;
  lastContactedAt: string | null;
  firstResponseAt?: string | null;
  nextFollowUpAt?: string | null;
  duplicateWarnings?: { id: string; name: string; company: string | null; stage: string; leadScore: number | null }[];
  lostReason?: { id: string; reasonCategory: string; notes: string | null; recordedAt: string } | null;
  activities?: LeadActivity[];
  proposals?: Proposal[];
  meetings?: LeadMeeting[];
  followUps?: LeadFollowUp[];
  notesList?: LeadNote[];
  attachments?: LeadAttachment[];
  latestActivity?: LeadActivity | null;
  latestProposal?: Proposal | null;
  nextMeeting?: LeadMeeting | null;
}

export interface LeadMeeting {
  id: string;
  title: string;
  type: string;
  scheduledAt: string;
  durationMins: number;
  meetingLink: string | null;
  location: string | null;
  attendees?: { id: string; name: string }[] | null;
  attendeeLinks?: {
    id: string;
    employeeId: string;
    status: string;
    employee?: { id: string; name: string } | null;
  }[];
  status: string;
  notes: string | null;
  createdBy?: { name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivity {
  id: string;
  type: string;
  content: string;
  changes?: Record<string, { old: unknown; new: unknown }> | null;
  loggedAt: string;
  loggedBy: { name: string } | null;
}

export interface LeadFollowUp {
  id: string;
  date: string;
  notes: string;
  status: "SCHEDULED" | "COMPLETED" | "MISSED";
  createdAt: string;
  updatedAt: string;
}

/** One row in the Today queue — a lead plus the next thing owed to it. */
export interface PulseWorkItem {
  id: string;
  uid: string | null;
  name: string;
  company: string | null;
  stage: string;
  priority: string;
  temperature: string;
  leadScore: number | null;
  probability: number;
  estimatedDealSize: number | null;
  currency: string;
  contactEmail: string | null;
  contactPhone: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  nextActionKind: "follow-up" | "meeting" | null;
  nextActionNote: string | null;
  followUpId: string | null;
  meetingId: string | null;
  assignedTo: { id: string; name: string } | null;
  daysSinceContact: number | null;
  stale: boolean;
}

export interface PulseWorklist {
  generatedAt: string;
  counts: {
    overdue: number;
    today: number;
    upcoming: number;
    unscheduled: number;
    stale: number;
    pipelineValue: number;
  };
  overdue: PulseWorkItem[];
  today: PulseWorkItem[];
  upcoming: PulseWorkItem[];
  unscheduled: PulseWorkItem[];
}

export interface LeadNote {
  id: string;
  content: string;
  createdBy: { name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadAttachment {
  id: string;
  title: string | null;
  fileUrl: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: { name: string } | null;
  createdAt: string;
}

export interface LeadCategory {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface Proposal {
  id: string;
  versionNumber: number;
  fileUrl: string | null;
  portalLink: string | null;
  sentDate: string | null;
  viewed: boolean;
  viewDurationSecs: number | null;
  status: string;
  createdAt: string;
}

export interface PipelineSummary {
  totalLeads: number;
  activeLeads: number;
  pipelineValue: number;
  weightedForecast: number;
  won: number;
  lost: number;
  winRate: number | null;
  hotLeads: number;
  staleLeads: number;
  /** Active leads whose first response passed the SLA (Control → Lead Rules). */
  slaBreached?: number;
  avgScore: number | null;
  followUpsDue: number;
  followUpsToday?: number;
  noNextAction?: number;
  urgentCount: number;
  avgResponseHours: number | null;
  starredCount: number;
  avgProbability: number | null;
  temperatureCounts: { HOT: number; WARM: number; COLD: number };
  categoryCounts: Record<string, number>;
  byStage: { id: string; name: string; order: number; slaDays: number; count: number; value: number }[];
  bySource: { source: string; count: number; won: number; conversionRate: number | null; value: number }[];
  byOwner: { ownerId: string; ownerName: string; count: number; won: number; conversionRate: number | null; value: number }[];
}

export interface UserLite {
  id: string;
  name: string;
  email: string;
  roleName: string;
  isActive: boolean;
}

export type ClientCategory = "ACTIVE" | "ON_HOLD" | "ARCHIVED";

export interface Client {
  id: string;
  companyName: string;
  industryVertical: string;
  category: ClientCategory;
  healthScore: number | null;
  healthLevel: string;
  healthDriver: string | null;
  billingCycleType: string;
  currencyPreference?: string;
  contractStartDate: string | null;
  renewalDate: string | null;
  notes?: string | null;
  createdAt?: string;
  /** Retainer settings — present on the raw record. */
  monthlyAmount?: number | string | null;
  monthlyServiceDescription?: string | null;
  billingDayOfMonth?: number | null;
  paymentDueDays?: number | null;
  retainerInterval?: string | null;
  autoGenerateInvoice?: boolean;
  lastAutoInvoiceCycle?: string | null;
  /** Company logo (WebP) + its JPEG XL sibling. */
  logoUrl?: string | null;
  logoJxlUrl?: string | null;
  accountOwner: { id: string; name: string } | null;
  /** Primary contact, resolved by the list endpoint for quick call/email actions. */
  primaryContact?: {
    id: string;
    name: string;
    roleTitle: string | null;
    email: string | null;
    phone: string | null;
    isPrimary?: boolean;
  } | null;
  /** First contacts returned by the list endpoint (used by search + pickers). */
  contacts?: {
    id: string;
    name: string;
    roleTitle: string | null;
    email: string | null;
    phone: string | null;
    isPrimary?: boolean;
  }[];
  _count?: { projects: number; invoices: number; contacts: number };
  totalInvoiced?: number;
  totalPaid?: number;
  totalDue?: number;
  /** Derived from invoice dates, not the stored status column. */
  overdueCount?: number;
  overdueAmount?: number;
  openInvoiceCount?: number;
  /** Not yet issued — excluded from outstanding. */
  draftAmount?: number;
  draftCount?: number;
  lastInvoiceDate?: string | null;
}

export interface ClientContact {
  id: string;
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  portalAccessEnabled?: boolean;
  portalUser?: { lastLoginAt: string | null; isActive: boolean } | null;
}

export interface ClientDocument {
  id: string;
  type: string;
  fileUrl: string;
  isEncrypted?: boolean;
  uploadedAt: string;
  uploadedBy: { name: string } | null;
}

export interface HealthLogEntry {
  id: string;
  score: number;
  driverSummary: string | null;
  recordedAt: string;
}

export interface ChurnFlag {
  id: string;
  riskLevel: string;
  matchedPattern: string | null;
  flaggedAt: string;
}

export interface ClientDetail extends Client {
  contacts: ClientContact[];
  documents: ClientDocument[];
  healthLogs: HealthLogEntry[];
  churnFlags: ChurnFlag[];
  projects: {
    id: string; name: string; status: string; healthStatus: string;
    riskScore: number | null; budgetAmount: number | null; targetEndDate: string | null;
  }[];
  invoices: {
    id: string; invoiceNumber: string; status: string; invoiceType?: string | null;
    issueDate: string; dueDate: string | null;
    lineItems: {
      description?: string | null;
      quantity?: number | string | null;
      unitPrice?: number | string | null;
      amount: number;
      revenueTag: string;
    }[];
    total?: number; paid?: number; balance?: number; refunded?: number;
    project?: { id: string; name: string } | null;
  }[];
  payments?: {
    id: string;
    amount: number;
    paymentMethod: string;
    paymentDate: string;
    referenceId: string | null;
    invoice: { invoiceNumber: string };
  }[];
  totalInvoiced: number;
  totalPaid: number;
  totalDue: number;
  /** Full-history counts — the `invoices` array above is only the recent page. */
  invoiceCount?: number;
  projectCount?: number;
  overdueCount?: number;
  overdueAmount?: number;
  draftAmount?: number;
  draftCount?: number;
  aging?: { current: number; d30: number; d60: number; d90: number; d90p: number };
  /** Cost side of the relationship, straight from Capital expenses. */
  finance?: {
    expensesTotal: number;
    pendingExpenses: number;
    billableExpenses: number;
    expenseCount: number;
    profit: number;
    margin: number | null;
    recentExpenses: {
      id: string; description: string; amount: number; category: string;
      date: string; approvalStatus: string; isClientBillable: boolean; projectId: string | null;
    }[];
  };
  /** Dollar Desk purchases — USD the client bought from the agency. */
  dollar?: {
    summary: {
      count: number;
      totalUsd: number;
      totalBdt: number;
      totalProfit: number;
      averageRate: number | null;
      lastPurchaseDate: string | null;
    };
    purchases: {
      id: string;
      reference: string;
      date: string;
      usdAmount: number;
      bdtAmount: number;
      rate: number;
      costRate: number;
      costBdt: number;
      profit: number;
      marginPct: number;
      paymentMethod: string;
      notes: string | null;
    }[];
  };
}

export interface AccountsOverview {
  totalClients: number;
  /** Archived clients are excluded from every KPI above. */
  archivedClients?: number;
  avgHealth: number | null;
  distribution: { GREEN: number; YELLOW: number; RED: number };
  renewalsNext30: { id: string; companyName: string; renewalDate: string | null; healthLevel?: string }[];
  atRiskCount: number;
  newThisMonth: number;
  churnFlagged: number;
  /** Portfolio money, so the board can lead with what is owed. */
  totalDue?: number;
  overdueAmount?: number;
  overdueClients?: number;
  mrr?: number;
  retainerMissingAmount?: number;
  noContact?: number;
  noOwner?: number;
  dataGaps?: number;
}

export interface ProjectReference {
  id: string;
  projectId: string;
  title: string;
  url?: string | null;
  type: string;
  fileUrl?: string | null;
  uploadedBy?: { name: string } | null;
  uploadedById?: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  type: string;
  status: string;
  healthStatus: string;
  riskScore: number | null;
  riskDriver: string | null;
  budgetAmount: number | null;
  amount?: number | null;
  targetEndDate: string | null;
  projectLink?: string | null;
  websiteUrl?: string | null;
  socialLinks?: { facebook?: string; linkedin?: string; instagram?: string } | null;
  references?: ProjectReference[];
  client: { id: string; companyName: string };
  assignedPm: { id: string; name: string } | null;
  sourceLead?: {
    id: string; name: string; company: string | null; source: string; vertical: string;
    estimatedDealSize: number | null; contactEmail: string | null; contactPhone: string | null;
  } | null;
  sourceProposal?: {
    id: string; versionNumber: number; status: string;
    fileUrl: string | null; portalLink: string | null; sentDate: string | null;
  } | null;
  _count?: { tasks: number; milestones: number };
}

export type DeliverableStatus = "PENDING" | "IN_PROGRESS" | "DELIVERED";
export type DeliverableKind = "GRAPHIC" | "VIDEO" | "PHOTO" | "COPY" | "OTHER";

export interface DeliverableCampaignRef {
  id: string;
  name: string;
}

export interface ProjectDeliverable {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  status: DeliverableStatus;
  /** What kind of asset this is — reports group by it. */
  kind: DeliverableKind | null;
  /** What the item actually is. */
  topic: string | null;
  /** Why it exists (Awareness / Launch / Conversion…). */
  objective: string | null;
  campaignId: string | null;
  campaign?: DeliverableCampaignRef | null;
  startDate: string | null;
  dueDate: string | null;
  clientVisible: boolean;
  ownerId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tasks?: { id: string; title: string; status: string }[];
}

export type ReportStatus = "DRAFT" | "FINAL" | "SENT";
export type ReportGrouping = "CAMPAIGN" | "KIND" | "OWNER" | "NONE";

export interface ReportBucket {
  delivered: number;
  deliveredInPeriod: number;
  pending: number;
  total: number;
}

export interface ReportKindBucket extends ReportBucket {}

export interface ReportCampaignBucket extends ReportBucket {
  campaignId: string | null;
  name: string;
}

export interface ReportOwnerBucket extends ReportBucket {
  employeeId: string | null;
  name: string;
}

export interface ReportDeliverableItem {
  deliverableId: string;
  title: string;
  topic: string | null;
  objective: string | null;
  kind: DeliverableKind | null;
  campaignId: string | null;
  campaignName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  completedAt?: string | null;
  status?: string;
  tasksDone?: number;
  tasksTotal?: number;
}

export interface ReportShootCrew {
  role: string;
  name: string;
  source: string;
  phone: string | null;
  callTime: string | null;
  isConfirmed: boolean;
  employeeId: string | null;
  vendorId: string | null;
}

export interface ReportShoot {
  id: string;
  title: string;
  date: string;
  endDate: string | null;
  duration: "HALF_DAY" | "FULL_DAY";
  callTime: string | null;
  wrapTime: string | null;
  location: string | null;
  status: string;
  description: string | null;
  equipment: string[];
  crew: ReportShootCrew[];
}

export interface ReportSummary {
  delivered: number;
  deliveredInPeriod: number;
  pending: number;
  total: number;
  byKind: Record<string, ReportKindBucket>;
  byCampaign: ReportCampaignBucket[];
  byOwner: ReportOwnerBucket[];
  shoots: {
    count: number;
    fullDays: number;
    halfDays: number;
    crewCount: number;
    equipmentCount: number;
  };
  tasksFromDeliverables: { total: number; done: number };
}

export interface ProjectReport {
  id: string;
  projectId: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  status: ReportStatus;
  completed: ReportDeliverableItem[];
  pending: ReportDeliverableItem[];
  billing: { invoiced: number; collected: number; outstanding: number } | null;
  pmNotes: string | null;
  groupBy?: ReportGrouping | null;
  campaignId?: string | null;
  campaignLabel?: string | null;
  summary?: ReportSummary | null;
  shoots?: ReportShoot[] | null;
  generatedBy: { name: string } | null;
  createdAt: string;
  sentAt: string | null;
}

// ── Shoots (production call-sheets) ───────────────────────────────────
export type ShootDuration = "HALF_DAY" | "FULL_DAY";
export type ShootStatus = "PLANNED" | "CONFIRMED" | "IN_PROGRESS" | "WRAPPED" | "CANCELLED";
export type ShootCrewRole =
  | "DOP"
  | "CAMERAMAN"
  | "ASSISTANT_CAMERA"
  | "GAFFER"
  | "GRIP"
  | "SOUND"
  | "ART_DIRECTOR"
  | "STYLIST"
  | "MAKEUP"
  | "PRODUCER"
  | "LINE_PRODUCER"
  | "PHOTOGRAPHER"
  | "DRONE_OPERATOR"
  | "DRIVER"
  | "TALENT"
  | "TEAM_MEMBER"
  | "OTHER";
export type ShootCrewSource = "EMPLOYEE" | "VENDOR" | "EXTERNAL";

export interface ShootCrewMember {
  id: string;
  shootId: string;
  role: ShootCrewRole;
  source: ShootCrewSource;
  employeeId: string | null;
  vendorId: string | null;
  name: string;
  phone: string | null;
  callTime: string | null;
  isConfirmed: boolean;
  fee: number | string | null;
  notes: string | null;
  employee?: { id: string; name: string; photoUrl?: string | null; roleTitle?: string } | null;
  vendor?: { id: string; name: string; phone?: string | null; category?: string | null } | null;
}

export interface Shoot {
  id: string;
  projectId: string;
  campaignId: string | null;
  campaign?: DeliverableCampaignRef | null;
  title: string;
  shootDate: string;
  endDate: string | null;
  durationType: ShootDuration;
  callTime: string | null;
  wrapTime: string | null;
  isDateLocked: boolean;
  location: string | null;
  locationUrl: string | null;
  locationNote: string | null;
  description: string | null;
  notes: string | null;
  equipment: string[];
  status: ShootStatus;
  calendarEventId: string | null;
  createdAt: string;
  updatedAt: string;
  crew: ShootCrewMember[];
}

export interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  estimatedHours: number | null;
  isClientVisible: boolean;
  project: { id: string; name: string; healthStatus: string } | null;
  assignedTo: { id: string; name: string } | null;
}

export interface Employee {
  id: string;
  name: string;
  roleTitle: string;
  department: string | null;
  employmentStatus: string;
  skillTags: string[];
  utilizationRate: number | null;
  billableHours: number | null;
  todayStatus: string;
  /** Profile photo (WebP) + its JPEG XL sibling. */
  photoUrl?: string | null;
  photoJxlUrl?: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  invoiceType: string;
  issueDate: string;
  dueDate: string | null;
  client: { id: string; companyName: string };
  project: { id: string; name: string } | null;
  lineItems: { id: string; description: string; amount: number; revenueTag: string }[];
  payments: { id: string; amount: number; paymentMethod: string; paymentDate: string }[];
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  date: string;
  isClientBillable: boolean;
  approvalStatus: string;
  client: { id: string; companyName: string } | null;
  project: { id: string; name: string } | null;
  vendor: { id: string; name: string } | null;
  submittedBy: { name: string } | null;
}
