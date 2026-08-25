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
  estimatedDealSize: number | null;
  currency: string;
  assignedTo: { id: string; name: string } | null;
  assignedToId?: string | null;
  convertedClientId?: string | null;
  client?: { id: string; companyName: string } | null;
  projects?: { id: string; name: string; status: string }[];
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

export interface LeadNote {
  id: string;
  content: string;
  createdBy: { name: string } | null;
  createdAt: string;
  updatedAt: string;
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
  avgScore: number | null;
  followUpsDue: number;
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
  accountOwner: { id: string; name: string } | null;
  _count?: { projects: number; invoices: number; contacts: number };
  totalInvoiced?: number;
  totalPaid?: number;
  totalDue?: number;
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
    id: string; invoiceNumber: string; status: string; issueDate: string;
    dueDate: string | null; lineItems: { amount: number; revenueTag: string }[];
    total?: number; paid?: number;
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
  aging?: { current: number; d30: number; d60: number; d90: number; d90p: number };
}

export interface AccountsOverview {
  totalClients: number;
  avgHealth: number | null;
  distribution: { GREEN: number; YELLOW: number; RED: number };
  renewalsNext30: { id: string; companyName: string; renewalDate: string | null }[];
  atRiskCount: number;
  newThisMonth: number;
  churnFlagged: number;
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
