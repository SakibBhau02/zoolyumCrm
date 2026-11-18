"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
const daysAgo = (n, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    return d;
};
const daysFromNow = (n, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(hour, 0, 0, 0);
    return d;
};
const bdt = (n) => new client_1.Prisma.Decimal(n);
async function main() {
    console.log("Seeding Zoolyum OS...");
    await prisma.$transaction([
        prisma.deliverableApproval.deleteMany(),
        prisma.clientComment.deleteMany(),
        prisma.portalActivityLog.deleteMany(),
        prisma.portalUser.deleteMany(),
        prisma.financeAuditLog.deleteMany(),
        prisma.reconciliationRecord.deleteMany(),
        prisma.bankAccount.deleteMany(),
        prisma.creditBalance.deleteMany(),
        prisma.budget.deleteMany(),
        prisma.payment.deleteMany(),
        prisma.invoiceLineItem.deleteMany(),
        prisma.invoice.deleteMany(),
        prisma.expense.deleteMany(),
        prisma.vendor.deleteMany(),
        prisma.account.deleteMany(),
        prisma.estimateAccuracyLog.deleteMany(),
        prisma.taskComment.deleteMany(),
        prisma.timeLog.deleteMany(),
        prisma.taskDependency.deleteMany(),
        prisma.task.deleteMany(),
        prisma.projectRiskLog.deleteMany(),
        prisma.projectFile.deleteMany(),
        prisma.milestone.deleteMany(),
        prisma.project.deleteMany(),
        prisma.projectTemplate.deleteMany(),
        prisma.churnRiskFlag.deleteMany(),
        prisma.clientHealthLog.deleteMany(),
        prisma.clientDocument.deleteMany(),
        prisma.clientContact.deleteMany(),
        prisma.client.deleteMany(),
        prisma.lostReason.deleteMany(),
        prisma.proposal.deleteMany(),
        prisma.leadActivity.deleteMany(),
        prisma.lead.deleteMany(),
        prisma.pipelineStage.deleteMany(),
        prisma.attritionRiskFlag.deleteMany(),
        prisma.utilizationLog.deleteMany(),
        prisma.performanceReview.deleteMany(),
        prisma.payrollRecord.deleteMany(),
        prisma.leaveBalance.deleteMany(),
        prisma.leaveRequest.deleteMany(),
        prisma.attendance.deleteMany(),
        prisma.employee.deleteMany(),
        prisma.metricSnapshot.deleteMany(),
        prisma.correlationInsight.deleteMany(),
        prisma.executiveDigestLog.deleteMany(),
        prisma.reportDefinition.deleteMany(),
        prisma.systemAuditLog.deleteMany(),
        prisma.brandingConfig.deleteMany(),
        prisma.integration.deleteMany(),
        prisma.user.deleteMany(),
        prisma.role.deleteMany(),
    ]);
    const perm = (view, edit, approve) => ({ view, edit, approve });
    const roleOwner = await prisma.role.create({
        data: {
            name: "Owner",
            description: "Full visibility and control across every module",
            modulePermissions: {
                PULSE: perm(true, true, true), ACCOUNTS: perm(true, true, true),
                FLOW: perm(true, true, true), TASKS: perm(true, true, true),
                PEOPLE: perm(true, true, true), CAPITAL: perm(true, true, true),
                INSIGHT: perm(true, true, true), PORTAL: perm(true, true, true),
                CONTROL: perm(true, true, true),
            },
        },
    });
    const roleSales = await prisma.role.create({
        data: {
            name: "Sales/BD",
            modulePermissions: {
                PULSE: perm(true, true, true), ACCOUNTS: perm(true, true, false),
                FLOW: perm(true, false, false), TASKS: perm(true, false, false),
                PEOPLE: perm(false, false, false), CAPITAL: perm(false, false, false),
                INSIGHT: perm(true, false, false), PORTAL: perm(false, false, false),
                CONTROL: perm(false, false, false),
            },
        },
    });
    const rolePm = await prisma.role.create({
        data: {
            name: "Project Manager",
            modulePermissions: {
                PULSE: perm(true, false, false), ACCOUNTS: perm(true, true, false),
                FLOW: perm(true, true, true), TASKS: perm(true, true, false),
                PEOPLE: perm(true, false, false), CAPITAL: perm(true, false, false),
                INSIGHT: perm(true, false, false), PORTAL: perm(true, true, false),
                CONTROL: perm(false, false, false),
            },
        },
    });
    const roleTeam = await prisma.role.create({
        data: {
            name: "Team Member",
            modulePermissions: {
                PULSE: perm(false, false, false), ACCOUNTS: perm(false, false, false),
                FLOW: perm(true, false, false), TASKS: perm(true, true, false),
                PEOPLE: perm(true, false, false), CAPITAL: perm(false, false, false),
                INSIGHT: perm(false, false, false), PORTAL: perm(false, false, false),
                CONTROL: perm(false, false, false),
            },
        },
    });
    const roleHr = await prisma.role.create({
        data: {
            name: "HR/Admin",
            modulePermissions: {
                PULSE: perm(false, false, false), ACCOUNTS: perm(false, false, false),
                FLOW: perm(false, false, false), TASKS: perm(false, false, false),
                PEOPLE: perm(true, true, true), CAPITAL: perm(true, false, false),
                INSIGHT: perm(false, false, false), PORTAL: perm(false, false, false),
                CONTROL: perm(true, true, false),
            },
        },
    });
    const roleFinance = await prisma.role.create({
        data: {
            name: "Finance",
            modulePermissions: {
                PULSE: perm(false, false, false), ACCOUNTS: perm(true, false, false),
                FLOW: perm(true, false, false), TASKS: perm(true, false, false),
                PEOPLE: perm(true, false, false), CAPITAL: perm(true, true, true),
                INSIGHT: perm(true, false, false), PORTAL: perm(false, false, false),
                CONTROL: perm(false, false, false),
            },
        },
    });
    const hash = (p) => bcrypt.hashSync(p, 10);
    const uSakib = await prisma.user.create({
        data: { name: "Sakib Hasan", email: "sakib@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: roleOwner.id, lastLoginAt: daysAgo(0, 9) },
    });
    const uSadia = await prisma.user.create({
        data: { name: "Sadia Rahman", email: "sadia@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: roleFinance.id, lastLoginAt: daysAgo(0, 8) },
    });
    const uRahim = await prisma.user.create({
        data: { name: "Rahim Uddin", email: "rahim@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: roleSales.id, lastLoginAt: daysAgo(1, 18) },
    });
    const uKarim = await prisma.user.create({
        data: { name: "Karim Ahmed", email: "karim@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: rolePm.id, lastLoginAt: daysAgo(0, 10) },
    });
    const uTanvir = await prisma.user.create({
        data: { name: "Tanvir Islam", email: "tanvir@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: rolePm.id, lastLoginAt: daysAgo(2, 11) },
    });
    const uNusrat = await prisma.user.create({
        data: { name: "Nusrat Jahan", email: "nusrat@zoolyum.com", passwordHash: hash("zoolyum123"), roleId: roleHr.id, lastLoginAt: daysAgo(0, 9) },
    });
    const empSakib = await prisma.employee.create({ data: { name: "Sakib Hasan", roleTitle: "Founder & CEO", department: "Leadership", joinDate: daysAgo(730), costRate: bdt(1500), skillTags: ["Strategy", "Sales"], user: { connect: { id: uSakib.id } } } });
    const empSadia = await prisma.employee.create({ data: { name: "Sadia Rahman", roleTitle: "Finance & Ops", department: "Finance", joinDate: daysAgo(540), costRate: bdt(700), skillTags: ["Accounting", "Operations"], user: { connect: { id: uSadia.id } } } });
    const empRahim = await prisma.employee.create({ data: { name: "Rahim Uddin", roleTitle: "BD Lead", department: "Sales", joinDate: daysAgo(400), costRate: bdt(600), skillTags: ["Sales", "Meta Ads"], user: { connect: { id: uRahim.id } } } });
    const empKarim = await prisma.employee.create({ data: { name: "Karim Ahmed", roleTitle: "Senior PM", department: "Delivery", joinDate: daysAgo(500), costRate: bdt(650), skillTags: ["Video Production", "Client Comms"], user: { connect: { id: uKarim.id } } } });
    const empTanvir = await prisma.employee.create({ data: { name: "Tanvir Islam", roleTitle: "PM", department: "Delivery", joinDate: daysAgo(300), costRate: bdt(550), skillTags: ["Web", "SEO"], user: { connect: { id: uTanvir.id } } } });
    const empNusrat = await prisma.employee.create({ data: { name: "Nusrat Jahan", roleTitle: "HR & Admin", department: "Operations", joinDate: daysAgo(250), costRate: bdt(500), skillTags: ["HR", "Payroll"], user: { connect: { id: uNusrat.id } } } });
    const empFahim = await prisma.employee.create({ data: { name: "Fahim Chowdhury", roleTitle: "Video Editor", department: "Delivery", joinDate: daysAgo(380), costRate: bdt(450), skillTags: ["Premiere Pro", "Motion Graphics"], reportingManagerId: empKarim.id } });
    const empMitu = await prisma.employee.create({ data: { name: "Mitu Akter", roleTitle: "Graphic Designer", department: "Delivery", joinDate: daysAgo(200), costRate: bdt(400), skillTags: ["Figma", "Illustrator"], reportingManagerId: empKarim.id } });
    const empSohan = await prisma.employee.create({ data: { name: "Sohan Mia", roleTitle: "Web Developer", department: "Delivery", joinDate: daysAgo(160), costRate: bdt(500), skillTags: ["WordPress", "Next.js"], reportingManagerId: empTanvir.id } });
    const empLamia = await prisma.employee.create({ data: { name: "Lamia Haque", roleTitle: "Content Writer", department: "Delivery", joinDate: daysAgo(90), costRate: bdt(350), skillTags: ["Copywriting", "Bangla Content"], reportingManagerId: empKarim.id } });
    const employees = [empSakib, empSadia, empRahim, empKarim, empTanvir, empNusrat, empFahim, empMitu, empSohan, empLamia];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const e of employees) {
        for (let d = 4; d >= 0; d--) {
            const date = daysAgo(d);
            date.setHours(0, 0, 0, 0);
            let status = "PRESENT";
            if (e.id === empLamia.id && d === 0)
                status = "ABSENT";
            if (e.id === empFahim.id && d === 1)
                status = "LATE";
            if (e.id === empMitu.id && d === 0)
                status = "WFH";
            if (e.id === empMitu.id && d === 2)
                status = "HALF_DAY";
            if (e.id === empRahim.id && d === 3)
                status = "ABSENT";
            const inTime = new Date(date);
            inTime.setHours(status === "LATE" ? 11 : 9, 30, 0, 0);
            const outTime = new Date(date);
            outTime.setHours(19, 0, 0, 0);
            await prisma.attendance.create({
                data: {
                    employeeId: e.id, date, status,
                    checkInTime: status === "ABSENT" ? null : inTime,
                    checkOutTime: status === "ABSENT" ? null : outTime,
                },
            });
        }
    }
    await prisma.leaveBalance.createMany({
        data: [
            { employeeId: empFahim.id, leaveType: "CASUAL", balanceDays: bdt(8), period: "2026" },
            { employeeId: empFahim.id, leaveType: "SICK", balanceDays: bdt(10), period: "2026" },
            { employeeId: empMitu.id, leaveType: "CASUAL", balanceDays: bdt(6), period: "2026" },
            { employeeId: empLamia.id, leaveType: "CASUAL", balanceDays: bdt(2), period: "2026" },
            { employeeId: empSohan.id, leaveType: "CASUAL", balanceDays: bdt(9), period: "2026" },
        ],
    });
    await prisma.leaveRequest.createMany({
        data: [
            { employeeId: empFahim.id, leaveType: "SICK", startDate: daysAgo(3), endDate: daysAgo(2), status: "APPROVED", appliedAt: daysAgo(5) },
            { employeeId: empMitu.id, leaveType: "CASUAL", startDate: daysFromNow(6), endDate: daysFromNow(6), status: "PENDING", appliedAt: daysAgo(1) },
            { employeeId: empLamia.id, leaveType: "CASUAL", startDate: daysFromNow(2), endDate: daysFromNow(3), status: "APPROVED", appliedAt: daysAgo(4) },
            { employeeId: empSohan.id, leaveType: "EARNED", startDate: daysFromNow(10), endDate: daysFromNow(12), status: "PENDING", appliedAt: daysAgo(2) },
        ],
    });
    const utilPlans = {
        [empSakib.id]: [0.4, 0.45, 0.42, 0.5], [empSadia.id]: [0.6, 0.65, 0.62, 0.58],
        [empRahim.id]: [0.75, 0.8, 0.78, 0.85], [empKarim.id]: [0.9, 0.95, 1.05, 1.1],
        [empTanvir.id]: [0.85, 0.9, 0.88, 0.92], [empNusrat.id]: [0.5, 0.55, 0.52, 0.6],
        [empFahim.id]: [0.95, 1.1, 1.15, 1.2], [empMitu.id]: [0.8, 0.85, 0.9, 0.95],
        [empSohan.id]: [0.9, 0.95, 1.0, 1.05], [empLamia.id]: [0.7, 0.75, 0.8, 0.72],
    };
    for (const e of employees) {
        const plan = utilPlans[e.id];
        for (let w = 0; w < 4; w++) {
            const weekStart = daysAgo((3 - w) * 7);
            weekStart.setHours(0, 0, 0, 0);
            await prisma.utilizationLog.create({
                data: {
                    employeeId: e.id, weekStartDate: weekStart,
                    billableHours: bdt(Math.round(160 * plan[w])), availableHours: bdt(160),
                    utilizationRate: plan[w],
                },
            });
        }
    }
    const salaries = [
        [empSakib, 250000], [empSadia, 90000], [empRahim, 80000], [empKarim, 85000],
        [empTanvir, 70000], [empNusrat, 60000], [empFahim, 55000], [empMitu, 45000],
        [empSohan, 60000], [empLamia, 35000],
    ];
    for (const [e, base] of salaries) {
        await prisma.payrollRecord.create({
            data: {
                employeeId: e.id, period: "2026-07",
                basicSalary: bdt(base), allowances: bdt(Math.round(base * 0.2)),
                deductions: bdt(Math.round(base * 0.05)), unpaidLeaveDeduction: bdt(0),
                bonus: e.id === empFahim.id ? bdt(5000) : bdt(0),
                netPay: bdt(Math.round(base * 1.2 - base * 0.05) + (e.id === empFahim.id ? 5000 : 0)),
                status: "FINALIZED",
                auditTrail: [{ source: "attendance_auto_draft", period: "2026-07" }],
            },
        });
    }
    await prisma.performanceReview.createMany({
        data: [
            { employeeId: empFahim.id, reviewPeriod: "H1-2026", selfScore: bdt(7), managerScore: bdt(7.5), objectiveSignals: { taskCompletionRate: 0.92, utilizationTrend: 1.15, sentimentScore: 0.8 }, reviewedById: uKarim.id, reviewedAt: daysAgo(20) },
            { employeeId: empLamia.id, reviewPeriod: "H1-2026", selfScore: bdt(8), managerScore: bdt(8), objectiveSignals: { taskCompletionRate: 0.96, utilizationTrend: 0.85, sentimentScore: 0.9 }, reviewedById: uKarim.id, reviewedAt: daysAgo(18) },
        ],
    });
    await prisma.attritionRiskFlag.create({
        data: { employeeId: empFahim.id, riskLevel: "HIGH", contributingFactors: "Utilization >115% for 3 weeks, reduced leave usage", flaggedAt: daysAgo(2) },
    });
    const stageNew = await prisma.pipelineStage.create({ data: { name: "New", order: 0, slaDays: 2 } });
    const stageContacted = await prisma.pipelineStage.create({ data: { name: "Contacted", order: 1, slaDays: 3 } });
    const stageProposal = await prisma.pipelineStage.create({ data: { name: "Proposal Sent", order: 2, slaDays: 5 } });
    const stageNegotiation = await prisma.pipelineStage.create({ data: { name: "Negotiation", order: 3, slaDays: 7 } });
    const stageWon = await prisma.pipelineStage.create({ data: { name: "Won", order: 4, slaDays: 0 } });
    const stageLost = await prisma.pipelineStage.create({ data: { name: "Lost", order: 5, slaDays: 0 } });
    const leadDefs = [
        { name: "Mehedi Karim", company: "Green Valley School", source: "REFERRAL", vertical: "EDUCATION", stage: "NEGOTIATION", score: 88, size: 480000, owner: uRahim.id, days: 21, phone: "+8801711-223344" },
        { name: "Dr. Farzana Alam", company: "Careline Diagnostics", source: "FACEBOOK", vertical: "HEALTHCARE", stage: "NEGOTIATION", score: 82, size: 320000, owner: uRahim.id, days: 14, phone: "+8801912-445566" },
        { name: "Rifat Hossain", company: "BanglaMart D2C", source: "WEBSITE", vertical: "D2C", stage: "PROPOSAL_SENT", score: 74, size: 260000, owner: uRahim.id, days: 9, phone: "+8801813-778899" },
        { name: "Shahidul Islam", company: "Metropolitan Coaching", source: "FACEBOOK", vertical: "EDUCATION", stage: "PROPOSAL_SENT", score: 68, size: 150000, owner: uRahim.id, days: 7, phone: "+8801555-112233" },
        { name: "Nabila Chowdhury", company: "Chowdhury Pharma", source: "REFERRAL", vertical: "HEALTHCARE", stage: "CONTACTED", score: 55, size: 200000, owner: uRahim.id, days: 4, phone: "+8801616-998877" },
        { name: "Arif Bhuiyan", company: "FitnessFirst BD", source: "COLD", vertical: "D2C", stage: "CONTACTED", score: 40, size: 120000, owner: uSakib.id, days: 2, phone: "+8801717-334455" },
        { name: "Selina Begum", company: "Sunshine Pre-school", source: "WEBSITE", vertical: "EDUCATION", stage: "NEW", score: 35, size: 90000, owner: uRahim.id, days: 1, phone: "+8801888-667788" },
        { name: "Tanim Rahman", company: "Echo Studio", source: "EMAIL", vertical: "OTHER", stage: "NEW", score: 30, size: 75000, owner: uRahim.id, days: 0, phone: "+8801999-445566" },
        { name: "Jashim Uddin", company: "North View College", source: "FACEBOOK", vertical: "EDUCATION", stage: "WON", score: 95, size: 540000, owner: uRahim.id, days: 40, phone: "+8801512-556677" },
        { name: "Sultana Parvin", company: "Urban Clinic Ltd", source: "COLD", vertical: "HEALTHCARE", stage: "LOST", score: 38, size: 180000, owner: uRahim.id, days: 30, phone: "+8801612-887766" },
    ];
    const leads = new Map();
    for (const l of leadDefs) {
        const created = await prisma.lead.create({
            data: {
                name: l.name, company: l.company, source: l.source, vertical: l.vertical,
                stage: l.stage, leadScore: l.score, estimatedDealSize: bdt(l.size),
                assignedToId: l.owner, contactPhone: l.phone, contactEmail: `${l.name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
                createdAt: daysAgo(l.days), lastContactedAt: l.days > 0 ? daysAgo(Math.max(l.days - 2, 0)) : null,
                convertedClientId: l.stage === "WON" ? "TBD" : null,
            },
        });
        leads.set(l.name, created);
    }
    await prisma.leadActivity.createMany({
        data: [
            { leadId: leads.get("Mehedi Karim").id, type: "CALL", content: "Discussed full video package + admission campaign. Sent cost breakdown.", loggedById: uRahim.id, loggedAt: daysAgo(3) },
            { leadId: leads.get("Mehedi Karim").id, type: "MEETING", content: "Met principal + admission coordinator at school. Budget confirmed 4.8L.", loggedById: uRahim.id, loggedAt: daysAgo(6) },
            { leadId: leads.get("Dr. Farzana Alam").id, type: "WHATSAPP", content: "Sent service portfolio and case studies.", loggedById: uRahim.id, loggedAt: daysAgo(2) },
            { leadId: leads.get("Rifat Hossain").id, type: "EMAIL", content: "Proposal PDF v2 sent with revised timeline.", loggedById: uRahim.id, loggedAt: daysAgo(1) },
        ],
    });
    await prisma.proposal.createMany({
        data: [
            { leadId: leads.get("Mehedi Karim").id, versionNumber: 1, fileUrl: "/storage/proposals/gvs-v1.pdf", sentDate: daysAgo(8), viewed: true, viewDurationSecs: 480, status: "SENT" },
            { leadId: leads.get("Rifat Hossain").id, versionNumber: 1, fileUrl: "/storage/proposals/banglamart-v1.pdf", sentDate: daysAgo(2), viewed: true, viewDurationSecs: 190, status: "SENT" },
            { leadId: leads.get("Shahidul Islam").id, versionNumber: 1, fileUrl: "/storage/proposals/metro-coaching-v1.pdf", sentDate: daysAgo(1), viewed: false, status: "SENT" },
        ],
    });
    await prisma.lostReason.create({
        data: { leadId: leads.get("Sultana Parvin").id, reasonCategory: "PRICE", notes: "Chose cheaper freelancer. Revisit next quarter." },
    });
    const clientDefs = [
        { company: "Green Valley School", vertical: "EDUCATION", owner: uKarim.id, health: 88, level: "GREEN", billing: "MONTHLY_RETAINER", renewal: 26, contractStart: 240, driver: null },
        { company: "Careline Diagnostics", vertical: "HEALTHCARE", owner: uKarim.id, health: 72, level: "YELLOW", billing: "PROJECT_BASED", renewal: 95, contractStart: 180, driver: "2 overdue invoices + declining margin over 3 months" },
        { company: "BanglaMart", vertical: "D2C", owner: uTanvir.id, health: 90, level: "GREEN", billing: "MONTHLY_RETAINER", renewal: 12, contractStart: 300, driver: null },
        { company: "North View College", vertical: "EDUCATION", owner: uKarim.id, health: 80, level: "GREEN", billing: "PROJECT_BASED", renewal: 60, contractStart: 120, driver: null },
        { company: "Urban Clinic Ltd", vertical: "HEALTHCARE", owner: uTanvir.id, health: 55, level: "RED", billing: "PROJECT_BASED", renewal: 45, contractStart: 200, driver: "3 overdue invoices + scope creep 35% over benchmark" },
        { company: "Smart Kids Academy", vertical: "EDUCATION", owner: uKarim.id, health: 78, level: "YELLOW", billing: "MONTHLY_RETAINER", renewal: 22, contractStart: 150, driver: "Engagement dip — no portal login 14 days" },
        { company: "GlowSkin Beauty", vertical: "D2C", owner: uTanvir.id, health: 92, level: "GREEN", billing: "MONTHLY_RETAINER", renewal: 120, contractStart: 420, driver: null },
    ];
    const clients = new Map();
    for (const c of clientDefs) {
        const cl = await prisma.client.create({
            data: {
                companyName: c.company, industryVertical: c.vertical, accountOwnerId: c.owner,
                healthScore: c.health, healthLevel: c.level, healthDriver: c.driver,
                billingCycleType: c.billing, contractStartDate: daysAgo(c.contractStart),
                renewalDate: daysFromNow(c.renewal),
            },
        });
        clients.set(c.company, cl);
    }
    await prisma.lead.update({ where: { id: leads.get("Jashim Uddin").id }, data: { convertedClientId: clients.get("North View College").id } });
    await prisma.clientContact.createMany({
        data: [
            { clientId: clients.get("Green Valley School").id, name: "Mehedi Karim", roleTitle: "Principal", email: "principal@gvs.edu.bd", phone: "+8801711-223344", isPrimary: true, portalAccessEnabled: true },
            { clientId: clients.get("Green Valley School").id, name: "Rina Akter", roleTitle: "Admission Coordinator", email: "rina@gvs.edu.bd", isPrimary: false, portalAccessEnabled: true },
            { clientId: clients.get("Careline Diagnostics").id, name: "Dr. Farzana Alam", roleTitle: "Director", email: "farzana@careline.bd", isPrimary: true, portalAccessEnabled: true },
            { clientId: clients.get("BanglaMart").id, name: "Rifat Hossain", roleTitle: "Owner", email: "rifat@banglamart.bd", isPrimary: true, portalAccessEnabled: true },
            { clientId: clients.get("Urban Clinic Ltd").id, name: "Dr. Salma Khatun", roleTitle: "Managing Director", email: "salma@urbanclinic.bd", isPrimary: true, portalAccessEnabled: false },
            { clientId: clients.get("GlowSkin Beauty").id, name: "Tasnim Ferdous", roleTitle: "Brand Manager", email: "tasnim@glowskin.bd", isPrimary: true, portalAccessEnabled: true },
            { clientId: clients.get("Smart Kids Academy").id, name: "Kamal Hossain", roleTitle: "Director", email: "kamal@smartkids.bd", isPrimary: true, portalAccessEnabled: true },
        ],
    });
    for (const [name, cl] of clients) {
        const base = cl.healthScore;
        await prisma.clientHealthLog.createMany({
            data: [
                { clientId: cl.id, score: Math.max(30, base - 8), driverSummary: "Month -3 snapshot", recordedAt: daysAgo(90) },
                { clientId: cl.id, score: Math.max(30, base - 4), driverSummary: "Month -2 snapshot", recordedAt: daysAgo(60) },
                { clientId: cl.id, score: Math.max(30, base - 1), driverSummary: "Month -1 snapshot", recordedAt: daysAgo(30) },
            ],
        });
    }
    await prisma.churnRiskFlag.createMany({
        data: [
            { clientId: clients.get("Urban Clinic Ltd").id, riskLevel: "HIGH", matchedPattern: "Overdue invoices + declining engagement matches churned-client pattern", flaggedAt: daysAgo(3) },
            { clientId: clients.get("Smart Kids Academy").id, riskLevel: "MEDIUM", matchedPattern: "Portal activity dropped sharply last 14 days", flaggedAt: daysAgo(1) },
        ],
    });
    await prisma.clientDocument.createMany({
        data: [
            { clientId: clients.get("Green Valley School").id, type: "MOU", fileUrl: "/storage/docs/gvs-mou-2026.pdf", uploadedById: uKarim.id },
            { clientId: clients.get("BanglaMart").id, type: "BRAND_ASSET", fileUrl: "/storage/docs/banglamart-brandkit.zip", uploadedById: uTanvir.id },
            { clientId: clients.get("GlowSkin Beauty").id, type: "PROPOSAL", fileUrl: "/storage/docs/glowskin-signed-proposal.pdf", uploadedById: uTanvir.id },
        ],
    });
    const tplVideo = await prisma.projectTemplate.create({
        data: {
            name: "School Video Production Package",
            description: "Script → shoot → edit → review → deliver",
            benchmarkDurationDays: 21, benchmarkHours: 90,
            defaultTaskList: ["Script writing", "Shoot planning", "Production day", "Editing", "Client review", "Final delivery"],
        },
    });
    const tplWeb = await prisma.projectTemplate.create({
        data: {
            name: "Website Audit + SEO Proposal",
            description: "Audit, recommendations, implementation",
            benchmarkDurationDays: 14, benchmarkHours: 45,
            defaultTaskList: ["Site crawl & audit", "Competitor analysis", "Recommendation deck", "Implementation"],
        },
    });
    const projectDefs = [
        { client: "Green Valley School", name: "Admission Campaign Video", type: "CAMPAIGN", tpl: tplVideo.id, pm: uKarim.id, budget: 320000, status: "ACTIVE", health: "ON_TRACK", risk: 22, start: 12, end: 12, driver: null },
        { client: "Green Valley School", name: "Monthly Content Retainer", type: "RETAINER", tpl: null, pm: uKarim.id, budget: 160000, status: "ACTIVE", health: "ON_TRACK", risk: 18, start: 200, end: 14, driver: null },
        { client: "Careline Diagnostics", name: "Brand Refresh + TVC", type: "FIXED", tpl: tplVideo.id, pm: uKarim.id, budget: 280000, status: "ACTIVE", health: "AT_RISK", risk: 62, start: 30, end: 20, driver: "Assignee at 118% utilization + budget burn 74% at 60% completion" },
        { client: "BanglaMart", name: "D2C Performance Campaign", type: "CAMPAIGN", tpl: null, pm: uTanvir.id, budget: 240000, status: "ACTIVE", health: "ON_TRACK", risk: 25, start: 25, end: 8, driver: null },
        { client: "BanglaMart", name: "Social Content Retainer", type: "RETAINER", tpl: null, pm: uTanvir.id, budget: 120000, status: "ACTIVE", health: "ON_TRACK", risk: 15, start: 120, end: 10, driver: null },
        { client: "North View College", name: "Convocation Documentary", type: "FIXED", tpl: tplVideo.id, pm: uKarim.id, budget: 420000, status: "COMPLETED", health: "ON_TRACK", risk: 5, start: 90, end: -30, driver: null },
        { client: "Urban Clinic Ltd", name: "Website Revamp", type: "FIXED", tpl: tplWeb.id, pm: uTanvir.id, budget: 180000, status: "ACTIVE", health: "DELAYED", risk: 78, start: 60, end: 25, driver: "Client approval pending 9 days + scope creep 35% over benchmark" },
        { client: "Smart Kids Academy", name: "Parent Engagement App", type: "FIXED", tpl: null, pm: uKarim.id, budget: 380000, status: "PLANNING", health: "AT_RISK", risk: 55, start: 5, end: 75, driver: "Requirement gathering incomplete, client unresponsive" },
        { client: "GlowSkin Beauty", name: "Q3 Influencer Campaign", type: "CAMPAIGN", tpl: null, pm: uTanvir.id, budget: 200000, status: "ACTIVE", health: "ON_TRACK", risk: 20, start: 10, end: 18, driver: null },
        { client: "GlowSkin Beauty", name: "Brand Film Series", type: "FIXED", tpl: tplVideo.id, pm: uKarim.id, budget: 260000, status: "PAUSED", health: "AT_RISK", risk: 45, start: 40, end: 35, driver: "Awaiting brand asset refresh from client" },
    ];
    const projects = new Map();
    for (const p of projectDefs) {
        const proj = await prisma.project.create({
            data: {
                clientId: clients.get(p.client).id, name: p.name, type: p.type, templateId: p.tpl,
                assignedPmId: p.pm, budgetAmount: bdt(p.budget), status: p.status,
                healthStatus: p.health, riskScore: p.risk, riskDriver: p.driver,
                startDate: daysAgo(p.start), targetEndDate: daysFromNow(p.end),
            },
        });
        projects.set(p.name, proj);
    }
    await prisma.milestone.createMany({
        data: [
            { projectId: projects.get("Admission Campaign Video").id, name: "Script approved", dueDate: daysAgo(8), status: "COMPLETED", clientVisible: true, completedAt: daysAgo(8) },
            { projectId: projects.get("Admission Campaign Video").id, name: "Shoot day", dueDate: daysAgo(3), status: "COMPLETED", clientVisible: true, completedAt: daysAgo(3) },
            { projectId: projects.get("Admission Campaign Video").id, name: "First edit review", dueDate: daysFromNow(2), status: "REVIEW", clientVisible: true },
            { projectId: projects.get("Admission Campaign Video").id, name: "Final delivery", dueDate: daysFromNow(8), status: "PENDING", clientVisible: true },
            { projectId: projects.get("Brand Refresh + TVC").id, name: "Concept board", dueDate: daysAgo(20), status: "COMPLETED", clientVisible: true, completedAt: daysAgo(20) },
            { projectId: projects.get("Brand Refresh + TVC").id, name: "TVC shoot", dueDate: daysFromNow(6), status: "IN_PRODUCTION", clientVisible: true },
            { projectId: projects.get("Website Revamp").id, name: "Design mockups", dueDate: daysAgo(10), status: "REVIEW", clientVisible: true },
            { projectId: projects.get("D2C Performance Campaign").id, name: "Ad creative batch 1", dueDate: daysAgo(2), status: "COMPLETED", clientVisible: true, completedAt: daysAgo(2) },
            { projectId: projects.get("Q3 Influencer Campaign").id, name: "Creator contracts", dueDate: daysFromNow(5), status: "IN_PRODUCTION", clientVisible: true },
        ],
    });
    const scriptFile = await prisma.projectFile.create({
        data: { projectId: projects.get("Admission Campaign Video").id, fileUrl: "/storage/files/gvs-script-v2.pdf", versionNumber: 2, uploadedById: uKarim.id, approvalStatus: "APPROVED", uploadedAt: daysAgo(8) },
    });
    await prisma.projectFile.create({
        data: { projectId: projects.get("Website Revamp").id, fileUrl: "/storage/files/urban-mockups-v3.fig", versionNumber: 3, uploadedById: uTanvir.id, approvalStatus: "REVISION_REQUESTED", uploadedAt: daysAgo(2) },
    });
    for (const [name, p] of projects) {
        await prisma.projectRiskLog.createMany({
            data: [
                { projectId: p.id, riskScore: Math.max(5, p.riskScore - 15), primaryDriver: "2 weeks ago", calculatedAt: daysAgo(14) },
                { projectId: p.id, riskScore: p.riskScore, primaryDriver: p.riskDriver ?? "steady", calculatedAt: daysAgo(1) },
            ],
        });
    }
    const taskDefs = [
        { title: "Shoot B-roll footage", proj: "Admission Campaign Video", emp: empFahim.id, pri: "HIGH", status: "DONE", due: -3, est: 6, clientVis: false, desc: "Campus tour + classroom B-roll" },
        { title: "Edit 60s admission film", proj: "Admission Campaign Video", emp: empFahim.id, pri: "URGENT", status: "IN_PROGRESS", due: 1, est: 12, clientVis: true, desc: "First cut with music + captions" },
        { title: "Design social cutdowns", proj: "Admission Campaign Video", emp: empMitu.id, pri: "MEDIUM", status: "TODO", due: 4, est: 5, clientVis: false, desc: "3× 15s cutdowns for Facebook/Instagram" },
        { title: "Write script v2", proj: "Admission Campaign Video", emp: empLamia.id, pri: "MEDIUM", status: "DONE", due: -9, est: 3, clientVis: false },
        { title: "TVC concept boards", proj: "Brand Refresh + TVC", emp: empMitu.id, pri: "HIGH", status: "REVIEW", due: 0, est: 8, clientVis: true },
        { title: "Shoot TVC day 1", proj: "Brand Refresh + TVC", emp: empFahim.id, pri: "URGENT", status: "TODO", due: 6, est: 14, clientVis: true },
        { title: "Meta ads setup", proj: "D2C Performance Campaign", emp: empRahim.id, pri: "HIGH", status: "DONE", due: -5, est: 4, clientVis: false },
        { title: "Creative batch 1 review", proj: "D2C Performance Campaign", emp: empMitu.id, pri: "HIGH", status: "IN_PROGRESS", due: 1, est: 3, clientVis: true },
        { title: "Site crawl & audit", proj: "Website Revamp", emp: empSohan.id, pri: "HIGH", status: "DONE", due: -15, est: 6, clientVis: false },
        { title: "Design mockups v3", proj: "Website Revamp", emp: empMitu.id, pri: "URGENT", status: "BLOCKED", due: 0, est: 10, clientVis: true, desc: "Blocked: client revision notes pending" },
        { title: "WordPress theme development", proj: "Website Revamp", emp: empSohan.id, pri: "HIGH", status: "IN_PROGRESS", due: 8, est: 20, clientVis: false },
        { title: "Monthly content calendar", proj: "Monthly Content Retainer", emp: empLamia.id, pri: "MEDIUM", status: "DONE", due: -1, est: 4, clientVis: true },
        { title: "Content batch: 12 posts", proj: "Monthly Content Retainer", emp: empLamia.id, pri: "HIGH", status: "IN_PROGRESS", due: 3, est: 8, clientVis: false },
        { title: "Batch 1 post design", proj: "Social Content Retainer", emp: empMitu.id, pri: "MEDIUM", status: "TODO", due: 2, est: 5, clientVis: false },
        { title: "Platform setup + posting", proj: "Social Content Retainer", emp: empRahim.id, pri: "MEDIUM", status: "DONE", due: -2, est: 2, clientVis: false },
        { title: "Convocation edit final", proj: "Convocation Documentary", emp: empFahim.id, pri: "MEDIUM", status: "DONE", due: -28, est: 15, clientVis: true },
        { title: "Requirement gathering doc", proj: "Parent Engagement App", emp: empKarim.id, pri: "HIGH", status: "BLOCKED", due: 3, est: 6, clientVis: false, desc: "Awaiting client decision on modules" },
        { title: "Influencer shortlist", proj: "Q3 Influencer Campaign", emp: empRahim.id, pri: "HIGH", status: "DONE", due: -4, est: 3, clientVis: false },
        { title: "Creator contracts + briefing", proj: "Q3 Influencer Campaign", emp: empKarim.id, pri: "HIGH", status: "IN_PROGRESS", due: 5, est: 4, clientVis: true },
        { title: "Brand film script", proj: "Brand Film Series", emp: empLamia.id, pri: "MEDIUM", status: "DONE", due: -30, est: 4, clientVis: true },
        { title: "Payroll draft July", proj: null, emp: empSadia.id, pri: "URGENT", status: "IN_PROGRESS", due: 0, est: 4, clientVis: false },
        { title: "Quarterly P&L review", proj: null, emp: empSadia.id, pri: "HIGH", status: "TODO", due: 5, est: 3, clientVis: false },
        { title: "Proposal for Careline v2", proj: null, emp: empRahim.id, pri: "HIGH", status: "IN_PROGRESS", due: 1, est: 3, clientVis: false },
        { title: "Q3 leave calendar", proj: null, emp: empNusrat.id, pri: "MEDIUM", status: "TODO", due: 7, est: 2, clientVis: false },
        { title: "Monthly utilization report", proj: null, emp: empNusrat.id, pri: "MEDIUM", status: "DONE", due: -1, est: 2, clientVis: false },
    ];
    const taskMap = new Map();
    for (const t of taskDefs) {
        const created = await prisma.task.create({
            data: {
                title: t.title, description: t.desc, projectId: t.proj ? projects.get(t.proj)?.id ?? null : null,
                assignedToId: t.emp, priority: t.pri, status: t.status,
                dueDate: t.due >= 0 ? daysFromNow(t.due) : daysAgo(-t.due),
                estimatedHours: bdt(t.est), isClientVisible: t.clientVis,
            },
        });
        taskMap.set(t.title, created);
    }
    await prisma.taskDependency.createMany({
        data: [
            { taskId: taskMap.get("Edit 60s admission film").id, dependsOnTaskId: taskMap.get("Shoot B-roll footage").id },
            { taskId: taskMap.get("Design social cutdowns").id, dependsOnTaskId: taskMap.get("Edit 60s admission film").id },
            { taskId: taskMap.get("WordPress theme development").id, dependsOnTaskId: taskMap.get("Design mockups v3").id },
            { taskId: taskMap.get("Shoot TVC day 1").id, dependsOnTaskId: taskMap.get("TVC concept boards").id },
        ],
    });
    const timeLogDefs = [
        ["Edit 60s admission film", 4, 1], ["Edit 60s admission film", 3.5, 0],
        ["TVC concept boards", 6, 0], ["Creative batch 1 review", 2.5, 1],
        ["WordPress theme development", 8, 0], ["WordPress theme development", 6, 1],
        ["Content batch: 12 posts", 4, 0], ["Monthly content calendar", 3, 2],
        ["Payroll draft July", 3, 0], ["Proposal for Careline v2", 2, 1],
        ["Influencer shortlist", 2.5, 3], ["Convocation edit final", 2, 4],
        ["Site crawl & audit", 1.5, 3], ["Meta ads setup", 2, 4],
        ["Monthly utilization report", 1.5, 1], ["Brand film script", 1, 4],
    ];
    for (const [title, hours, d] of timeLogDefs) {
        const task = taskMap.get(title);
        if (!task)
            continue;
        const emp = await prisma.employee.findFirst({ where: { tasks: { some: { id: task.id } } } });
        const date = daysAgo(d);
        date.setHours(0, 0, 0, 0);
        await prisma.timeLog.create({ data: { taskId: task.id, employeeId: emp?.id ?? empFahim.id, hours: bdt(hours), date, loggedVia: d % 2 ? "MANUAL" : "TIMER" } });
    }
    await prisma.taskComment.createMany({
        data: [
            { taskId: taskMap.get("Edit 60s admission film").id, authorId: uKarim.id, content: "Client loved the rushes. Keep the energy high on the cut.", mentionedUserIds: [] },
            { taskId: taskMap.get("Design mockups v3").id, authorId: uTanvir.id, content: "Waiting on client revision notes since Monday.", mentionedUserIds: [] },
        ],
    });
    const acctRevenue = await prisma.account.create({ data: { name: "Retainer Revenue", category: "REVENUE" } });
    await prisma.account.create({ data: { name: "Project Revenue", category: "REVENUE" } });
    await prisma.account.create({ data: { name: "Ad Management Fee", category: "REVENUE" } });
    await prisma.account.create({ data: { name: "Other Income", category: "REVENUE" } });
    const acctAdSpend = await prisma.account.create({ data: { name: "Client-Billable Ad Spend", category: "DIRECT_COST" } });
    const acctFreelancer = await prisma.account.create({ data: { name: "Freelancer Payments", category: "DIRECT_COST" } });
    const acctProduction = await prisma.account.create({ data: { name: "Production Costs", category: "DIRECT_COST" } });
    const acctSalary = await prisma.account.create({ data: { name: "Salaries", category: "OPEX" } });
    const acctSoftware = await prisma.account.create({ data: { name: "Software & Subscriptions", category: "OPEX" } });
    const acctRent = await prisma.account.create({ data: { name: "Rent & Utilities", category: "OPEX" } });
    await prisma.account.create({ data: { name: "Marketing", category: "OPEX" } });
    await prisma.account.create({ data: { name: "Receivables", category: "ASSET" } });
    await prisma.account.create({ data: { name: "Cash & Bank", category: "ASSET" } });
    await prisma.account.create({ data: { name: "Payables", category: "LIABILITY" } });
    await prisma.bankAccount.createMany({
        data: [
            { accountName: "DBBL Business", accountType: "BANK", currentBalance: bdt(2450000) },
            { accountName: "bKash Business", accountType: "BKASH", currentBalance: bdt(680000) },
            { accountName: "Nagad Business", accountType: "NAGAD", currentBalance: bdt(320000) },
            { accountName: "Petty Cash", accountType: "CASH", currentBalance: bdt(45000) },
        ],
    });
    const vendorFb = await prisma.vendor.create({ data: { name: "Meta Platforms", category: "Ad Spend" } });
    await prisma.vendor.create({ data: { name: "Fiverr Freelancers", category: "Freelancer" } });
    await prisma.vendor.create({ data: { name: "Cameraman Rafi", category: "Production" } });
    await prisma.vendor.create({ data: { name: "Adobe", category: "Software" } });
    await prisma.expense.createMany({
        data: [
            { description: "Facebook ads — BanglaMart July", amount: bdt(185000), category: "AD_SPEND", accountId: acctAdSpend.id, date: daysAgo(6), vendorId: vendorFb.id, paymentMethod: "BANK_TRANSFER", isClientBillable: true, clientId: clients.get("BanglaMart").id, projectId: projects.get("D2C Performance Campaign").id, approvalStatus: "APPROVED", submittedById: uRahim.id, approvedById: uSadia.id },
            { description: "Facebook ads — GlowSkin July", amount: bdt(92000), category: "AD_SPEND", accountId: acctAdSpend.id, date: daysAgo(8), vendorId: vendorFb.id, paymentMethod: "BANK_TRANSFER", isClientBillable: true, clientId: clients.get("GlowSkin Beauty").id, projectId: projects.get("Q3 Influencer Campaign").id, approvalStatus: "APPROVED", submittedById: uRahim.id, approvedById: uSadia.id },
            { description: "Motion graphics freelancer", amount: bdt(24000), category: "FREELANCER", accountId: acctFreelancer.id, date: daysAgo(5), vendorId: vendorFb.id, paymentMethod: "BKASH", isClientBillable: false, projectId: projects.get("Admission Campaign Video").id, approvalStatus: "APPROVED", submittedById: uKarim.id, approvedById: uSadia.id },
            { description: "Camera + lighting rental", amount: bdt(18000), category: "PRODUCTION", accountId: acctProduction.id, date: daysAgo(4), vendorId: vendorFb.id, paymentMethod: "CASH", isClientBillable: true, clientId: clients.get("Careline Diagnostics").id, projectId: projects.get("Brand Refresh + TVC").id, approvalStatus: "APPROVED", submittedById: uKarim.id, approvedById: uSadia.id },
            { description: "Adobe Creative Cloud", amount: bdt(12000), category: "SOFTWARE", accountId: acctSoftware.id, date: daysAgo(3), vendorId: vendorFb.id, paymentMethod: "CARD", isClientBillable: false, approvalStatus: "APPROVED", submittedById: uSadia.id },
            { description: "Office rent — August", amount: bdt(45000), category: "RENT", accountId: acctRent.id, date: daysAgo(2), vendorId: null, paymentMethod: "BANK_TRANSFER", isClientBillable: false, approvalStatus: "PENDING", submittedById: uSadia.id },
            { description: "Ads test batch — Smart Kids", amount: bdt(15000), category: "AD_SPEND", accountId: acctAdSpend.id, date: daysAgo(1), vendorId: vendorFb.id, paymentMethod: "BKASH", isClientBillable: true, clientId: clients.get("Smart Kids Academy").id, approvalStatus: "PENDING", submittedById: uRahim.id },
            { description: "Sound editor — TVC", amount: bdt(8500), category: "FREELANCER", accountId: acctFreelancer.id, date: daysAgo(7), vendorId: vendorFb.id, paymentMethod: "NAGAD", isClientBillable: true, clientId: clients.get("Careline Diagnostics").id, projectId: projects.get("Brand Refresh + TVC").id, approvalStatus: "APPROVED", submittedById: uKarim.id, approvedById: uSadia.id },
        ],
    });
    const invDefs = [
        { client: "Green Valley School", project: "Monthly Content Retainer", num: "ZLM-2026-0034", type: "RECURRING", issue: 30, due: 15, status: "PAID", lines: [{ d: "Content retainer — July", q: 1, u: 160000, tag: "AGENCY_REVENUE" }] },
        { client: "Green Valley School", project: "Admission Campaign Video", num: "ZLM-2026-0041", type: "ONE_TIME", issue: 12, due: 5, status: "PARTIALLY_PAID", lines: [{ d: "Admission campaign video — 60% milestone", q: 1, u: 192000, tag: "AGENCY_REVENUE" }] },
        { client: "BanglaMart", project: "D2C Performance Campaign", num: "ZLM-2026-0042", type: "COMBINED", issue: 8, due: 3, status: "VIEWED", lines: [{ d: "Management fee — July", q: 1, u: 55000, tag: "MANAGEMENT_FEE" }, { d: "Ad spend pass-through", q: 1, u: 185000, tag: "PASS_THROUGH" }] },
        { client: "BanglaMart", project: "Social Content Retainer", num: "ZLM-2026-0043", type: "RECURRING", issue: 5, due: 0, status: "SENT", lines: [{ d: "Social content retainer — August", q: 1, u: 120000, tag: "AGENCY_REVENUE" }] },
        { client: "Careline Diagnostics", project: "Brand Refresh + TVC", num: "ZLM-2026-0039", type: "ONE_TIME", issue: 25, due: 11, status: "OVERDUE", lines: [{ d: "Brand refresh — concept milestone", q: 1, u: 84000, tag: "AGENCY_REVENUE" }] },
        { client: "Careline Diagnostics", project: "Brand Refresh + TVC", num: "ZLM-2026-0044", type: "ONE_TIME", issue: 2, due: 12, status: "DRAFT", lines: [{ d: "TVC production deposit", q: 1, u: 140000, tag: "AGENCY_REVENUE" }] },
        { client: "GlowSkin Beauty", project: "Q3 Influencer Campaign", num: "ZLM-2026-0045", type: "COMBINED", issue: 1, due: 14, status: "SENT", lines: [{ d: "Campaign management — August", q: 1, u: 40000, tag: "MANAGEMENT_FEE" }, { d: "Ad spend pass-through", q: 1, u: 92000, tag: "PASS_THROUGH" }] },
        { client: "North View College", project: "Convocation Documentary", num: "ZLM-2026-0030", type: "ONE_TIME", issue: 45, due: 30, status: "PAID", lines: [{ d: "Convocation documentary — full", q: 1, u: 420000, tag: "AGENCY_REVENUE" }] },
        { client: "Urban Clinic Ltd", project: "Website Revamp", num: "ZLM-2026-0036", type: "ONE_TIME", issue: 35, due: 21, status: "OVERDUE", lines: [{ d: "Website revamp — 50% advance", q: 1, u: 90000, tag: "AGENCY_REVENUE" }] },
        { client: "Urban Clinic Ltd", project: "Website Revamp", num: "ZLM-2026-0040", type: "ONE_TIME", issue: 18, due: 4, status: "OVERDUE", lines: [{ d: "Website revamp — milestone 2", q: 1, u: 54000, tag: "AGENCY_REVENUE" }] },
        { client: "Smart Kids Academy", project: "Parent Engagement App", num: "ZLM-2026-0046", type: "ADVANCE", issue: 0, due: 15, status: "DRAFT", lines: [{ d: "App development — 30% advance", q: 1, u: 114000, tag: "AGENCY_REVENUE" }] },
        { client: "GlowSkin Beauty", project: "Brand Film Series", num: "ZLM-2026-0037", type: "ONE_TIME", issue: 20, due: 6, status: "PAID", lines: [{ d: "Brand film — script milestone", q: 1, u: 78000, tag: "AGENCY_REVENUE" }] },
    ];
    for (const inv of invDefs) {
        const created = await prisma.invoice.create({
            data: {
                invoiceNumber: inv.num, clientId: clients.get(inv.client).id,
                projectId: inv.project ? projects.get(inv.project)?.id ?? null : null,
                invoiceType: inv.type, status: inv.status, issueDate: daysAgo(inv.issue),
                dueDate: inv.due >= 0 ? daysFromNow(inv.due) : daysAgo(-inv.due),
                createdById: uSadia.id,
                lineItems: { create: inv.lines.map((l) => ({ description: l.d, quantity: bdt(l.q), unitPrice: bdt(l.u), amount: bdt(l.q * l.u), revenueTag: l.tag })) },
            },
        });
        if (inv.status === "PAID" || inv.status === "PARTIALLY_PAID") {
            const total = inv.lines.reduce((s, l) => s + l.q * l.u, 0);
            const paid = inv.status === "PAID" ? total : Math.round(total * 0.6);
            const method = ["BKASH", "NAGAD", "BANK_TRANSFER"][invDefs.indexOf(inv) % 3];
            await prisma.payment.create({
                data: { invoiceId: created.id, amount: bdt(paid), paymentMethod: method, referenceId: `TXN-${created.invoiceNumber.slice(-4)}`, paymentDate: daysAgo(Math.max(inv.issue - 2, 1)), recordedById: uSadia.id },
            });
        }
    }
    await prisma.creditBalance.create({
        data: { clientId: clients.get("GlowSkin Beauty").id, amount: bdt(12500), source: "Overpayment" },
    });
    await prisma.budget.createMany({
        data: [
            { scopeType: "PROJECT", projectId: projects.get("Admission Campaign Video").id, budgetAmount: bdt(320000) },
            { scopeType: "PROJECT", projectId: projects.get("Brand Refresh + TVC").id, budgetAmount: bdt(280000) },
            { scopeType: "PROJECT", projectId: projects.get("Website Revamp").id, budgetAmount: bdt(180000) },
            { scopeType: "PROJECT", projectId: projects.get("D2C Performance Campaign").id, budgetAmount: bdt(240000) },
        ],
    });
    await prisma.reconciliationRecord.createMany({
        data: [
            { bankAccountId: (await prisma.bankAccount.findFirst({ where: { accountType: "BANK" } })).id, statementDate: daysAgo(1), statementAmount: bdt(192000), statementReference: "STMT-JUL-04", matchedPaymentId: null, matchStatus: "MATCHED" },
            { bankAccountId: (await prisma.bankAccount.findFirst({ where: { accountType: "BKASH" } })).id, statementDate: daysAgo(1), statementAmount: bdt(18000), statementReference: "BK-7312", matchedPaymentId: null, matchStatus: "UNMATCHED" },
        ],
    });
    const trend = [
        { m: 0, inv: 680000, col: 640000, exp: 510000, pv: 900000 },
        { m: 1, inv: 720000, col: 700000, exp: 540000, pv: 1050000 },
        { m: 2, inv: 760000, col: 730000, exp: 560000, pv: 1100000 },
        { m: 3, inv: 810000, col: 790000, exp: 580000, pv: 1250000 },
        { m: 4, inv: 860000, col: 820000, exp: 610000, pv: 1350000 },
        { m: 5, inv: 920000, col: 890000, exp: 640000, pv: 1480000 },
        { m: 6, inv: 980000, col: 950000, exp: 670000, pv: 1650000 },
        { m: 7, inv: 1050000, col: 990000, exp: 705000, pv: 1820000 },
    ];
    for (let i = 0; i < trend.length; i++) {
        const t = trend[i];
        const monthDate = new Date();
        monthDate.setMonth(monthDate.getMonth() - (7 - i));
        monthDate.setDate(1);
        await prisma.metricSnapshot.createMany({
            data: [
                { metricName: "monthly_invoiced", value: t.inv, recordedAt: monthDate },
                { metricName: "monthly_collected", value: t.col, recordedAt: monthDate },
                { metricName: "monthly_expenses", value: t.exp, recordedAt: monthDate },
                { metricName: "weighted_pipeline", value: t.pv, recordedAt: monthDate },
            ],
        });
    }
    await prisma.correlationInsight.createMany({
        data: [
            { description: "Projects using the School Video template have 40% higher margin than custom-scoped video work", supportingData: { template: "School Video Production Package", marginDelta: "+40%" }, confidenceLevel: 0.82, surfacedAt: daysAgo(1) },
            { description: "Referral-acquired clients show 2.3x the lifetime value of cold-outreach clients", supportingData: { segment: "referral vs cold", ltvRatio: 2.3 }, confidenceLevel: 0.77, surfacedAt: daysAgo(2) },
            { description: "Education-vertical leads convert slower but retain 1.6x longer than D2C", supportingData: { educationCycle: "38d", d2cCycle: "21d" }, confidenceLevel: 0.71, surfacedAt: daysAgo(4) },
        ],
    });
    await prisma.executiveDigestLog.create({
        data: { period: "2026-W32", snapshotData: { pipeline: 1820000, utilization: 0.92, cash: 3490000 }, deliveryStatus: "SENT" },
    });
    const gvsContact = await prisma.clientContact.findFirst({ where: { clientId: clients.get("Green Valley School").id, isPrimary: true } });
    const bmContact = await prisma.clientContact.findFirst({ where: { clientId: clients.get("BanglaMart").id, isPrimary: true } });
    const skContact = await prisma.clientContact.findFirst({ where: { clientId: clients.get("Smart Kids Academy").id, isPrimary: true } });
    const pv1 = await prisma.portalUser.create({ data: { clientContactId: gvsContact.id, passwordHash: hash("portal123"), lastLoginAt: daysAgo(1, 20) } });
    const pv2 = await prisma.portalUser.create({ data: { clientContactId: bmContact.id, passwordHash: hash("portal123"), lastLoginAt: daysAgo(2, 16) } });
    const pv3 = await prisma.portalUser.create({ data: { clientContactId: skContact.id, passwordHash: hash("portal123"), lastLoginAt: daysAgo(9, 12) } });
    await prisma.portalActivityLog.createMany({
        data: [
            { portalUserId: pv1.id, action: "APPROVED_DELIVERABLE", relatedEntityType: "ProjectFile", relatedEntityId: scriptFile.id, timestamp: daysAgo(7, 15) },
            { portalUserId: pv1.id, action: "VIEWED_INVOICE", relatedEntityType: "Invoice", relatedEntityId: "ZLM-2026-0041", timestamp: daysAgo(2, 11) },
            { portalUserId: pv2.id, action: "VIEWED_INVOICE", relatedEntityType: "Invoice", relatedEntityId: "ZLM-2026-0042", timestamp: daysAgo(1, 18) },
            { portalUserId: pv3.id, action: "LOGGED_IN", timestamp: daysAgo(9, 12) },
        ],
    });
    await prisma.clientComment.createMany({
        data: [
            { projectId: projects.get("Admission Campaign Video").id, portalUserId: pv1.id, content: "Footage looks amazing! Can we include a few shots of the science lab?", sentiment: "POSITIVE", createdAt: daysAgo(3, 14) },
            { projectId: projects.get("Website Revamp").id, portalUserId: pv2.id, content: "We've been waiting 9 days for these mockups. When will we get them?", sentiment: "NEGATIVE_URGENT", createdAt: daysAgo(1, 10) },
        ],
    });
    await prisma.deliverableApproval.create({
        data: { projectFileId: scriptFile.id, portalUserId: pv1.id, decision: "APPROVED", revisionNotes: "Approved with minor caption fixes", decidedAt: daysAgo(7, 15) },
    });
    await prisma.brandingConfig.create({
        data: { logoUrl: "/brand/zoolyum-wordmark-dark.png", logoDarkUrl: "/brand/zoolyum-wordmark-dark.png", logoLightUrl: "/brand/zoolyum-wordmark-light.png", primaryColor: "#FF5001", secondaryColor: "#FF8A2B", invoiceNumberingFormat: "ZLM-{year}-{seq}" },
    });
    await prisma.integration.createMany({
        data: [
            { providerName: "Facebook Lead Ads", type: "ADS", status: "CONNECTED", connectedById: uSakib.id, connectedAt: daysAgo(60) },
            { providerName: "bKash Business API", type: "PAYMENT", status: "DISCONNECTED" },
            { providerName: "SSLCommerz", type: "PAYMENT", status: "DISCONNECTED" },
            { providerName: "DBBL Statement Import", type: "BANKING", status: "CONNECTED", connectedById: uSadia.id, connectedAt: daysAgo(30) },
        ],
    });
    await prisma.systemAuditLog.createMany({
        data: [
            { actorUserId: uSadia.id, action: "INVOICE_SENT", entityType: "Invoice", entityId: "ZLM-2026-0043", afterValue: { status: "SENT" } },
            { actorUserId: uNusrat.id, action: "PAYROLL_FINALIZED", entityType: "PayrollRecord", entityId: "2026-07" },
            { actorUserId: uSakib.id, action: "ROLE_UPDATED", entityType: "Role", entityId: roleFinance.id, afterValue: { name: "Finance" } },
        ],
    });
    console.log("✅ Seed complete:");
    console.log(`  Users: ${await prisma.user.count()}, Clients: ${await prisma.client.count()}, Projects: ${await prisma.project.count()}, Tasks: ${await prisma.task.count()}, Invoices: ${await prisma.invoice.count()}, Employees: ${await prisma.employee.count()}`);
}
main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map