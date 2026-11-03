// Demo organisation: fictional, flagged demo=1 so it can be removed without touching real data.
import type { DatabaseSync } from "node:sqlite";
import { getSetting, setSetting } from "./db.js";

type Ctl = [title: string, owner: string, dueInDays: number, status: "planned" | "in-progress" | "done"];
type DemoRisk = { title: string; description: string; l: number; s: number; rl?: number; rs?: number; controls: Ctl[] };
type DemoActivity = {
  dept: string; name: string; purpose: string; description: string; data: string; subjects: string; ai: string; vendor: string;
  where: string; xb: 0 | 1; basis: string; retention: string; necessity: string; screening: string[];
  dpo?: string; views?: string; signed?: string; risks: DemoRisk[];
};

export const DEMO_DEPARTMENTS = ["Human Resources", "Customer Service", "Finance & Risk", "Marketing", "IT & Security", "Legal & Compliance"];

const DEMO: DemoActivity[] = [
  { dept: "Human Resources", name: "CV screening with an LLM",
    purpose: "Rank incoming job applications so recruiters read the best matches first.",
    description: "Applicant CVs are sent to a large language model that scores them against the job description. Recruiters see the ranked list and decide who to interview.",
    data: "Name, contact details, work history, education, photo, salary expectation", subjects: "Job applicants (including fresh graduates)",
    ai: "Hosted LLM via API", vendor: "Overseas AI vendor (processor)", where: "Vendor cloud, United States", xb: 1,
    basis: "Legitimate interest (recruitment); consent for talent-pool storage", retention: "Rejected applicants: 12 months, then deleted",
    necessity: "Recruiters receive about 300 CVs per vacancy. Ranking saves time. Final decisions stay with people, and only the CV text is sent, not the photo.",
    screening: ["new-technology", "scoring-monitoring", "vulnerable-subjects"],
    dpo: "Proceed only with a signed processing agreement and a human check on every rejection.", views: "Candidate representative group consulted in March.",
    risks: [
      { title: "Biased ranking disadvantages some candidates", description: "The model may learn bias from wording, gender or school names.", l: 3, s: 4, rl: 2, rs: 3,
        controls: [["A recruiter reviews every rejection", "Head of HR", 20, "done"], ["Quarterly bias test on a sample of ranked CVs", "HR Analytics", 60, "in-progress"]] },
      { title: "Applicant data is transferred abroad without safeguards", description: "CV text is processed on servers outside Indonesia.", l: 3, s: 3, rl: 1, rs: 3,
        controls: [["Sign a data processing agreement with transfer safeguards", "Legal", 14, "done"], ["Remove names and contact details before sending the CV", "IT", 30, "planned"]] },
    ] },
  { dept: "Human Resources", name: "Employee sentiment analysis",
    purpose: "Understand team morale from open-text survey answers.", description: "An AI summarises themes in the yearly engagement survey comments, grouped by division.",
    data: "Survey comments, division, tenure band", subjects: "Employees", ai: "Text classification model (self-hosted)", vendor: "None (in-house)", where: "Company data centre, Jakarta", xb: 0,
    basis: "Legitimate interest", retention: "Raw comments 24 months", necessity: "Managers need themes, not individual comments, so results are shown only for groups of 10 or more.",
    screening: ["scoring-monitoring", "vulnerable-subjects"],
    risks: [{ title: "Employees can be identified from their comments", description: "Small teams or unusual remarks can reveal who wrote them.", l: 3, s: 3, rl: 2, rs: 2,
      controls: [["Never show groups smaller than 10", "HR Analytics", 10, "done"], ["Strip names and places from comments before analysis", "HR Analytics", 25, "in-progress"]] }] },
  { dept: "Human Resources", name: "Biometric attendance",
    purpose: "Record staff attendance with fingerprint and face scan at the office entrance.", description: "Terminals match a face or fingerprint to a stored template and write a time record to payroll.",
    data: "Fingerprint and face templates, employee ID, entry and exit times", subjects: "Employees and contractors", ai: "Face and fingerprint matching", vendor: "Terminal vendor (support access only)", where: "Company data centre, Jakarta", xb: 0,
    basis: "Employment contract; consent for the biometric template", retention: "Templates deleted at exit; time records 5 years",
    necessity: "Replaces paper sign-in that was easy to falsify. A card alternative is offered to staff who object.", screening: ["specific-data", "large-scale", "vulnerable-subjects"],
    risks: [{ title: "Biometric template is stolen", description: "A leaked template cannot be changed like a password.", l: 2, s: 4, rl: 1, rs: 4,
      controls: [["Store encrypted templates only, never images", "IT Security", 30, "done"], ["Offer a card alternative to every employee", "HR", 15, "done"]] }] },
  { dept: "Customer Service", name: "Support chatbot with company knowledge",
    purpose: "Answer common customer questions on the website and in the mobile app, any time of day.", description: "A chatbot searches our help articles and writes an answer. A person takes over when the customer asks or the bot is unsure.",
    data: "Chat messages, name, account number if the customer shares it", subjects: "Customers", ai: "LLM with retrieval over help articles", vendor: "Overseas AI vendor (processor)", where: "Vendor cloud, Singapore", xb: 1,
    basis: "Performance of contract; legitimate interest", retention: "Chat logs 6 months", necessity: "Cuts waiting time. Customers can always choose a human agent.",
    screening: ["new-technology", "large-scale"],
    risks: [
      { title: "Bot reveals one customer's data to another", description: "Retrieval could mix up accounts.", l: 2, s: 4, rl: 1, rs: 4,
        controls: [["The bot cannot read account data, only public articles", "Product Owner", 7, "done"], ["Block account numbers from being stored in chat logs", "IT", 21, "in-progress"]] },
      { title: "Bot gives wrong advice with confidence", description: "A made-up answer about fees or terms.", l: 3, s: 3, rl: 2, rs: 2,
        controls: [["Answer only from approved articles and show the source", "Product Owner", 30, "in-progress"], ["Weekly review of 50 random conversations", "Service Quality", 45, "planned"]] },
    ] },
  { dept: "Customer Service", name: "Call recording transcription and quality scoring",
    purpose: "Transcribe support calls and score agent quality.", description: "Recorded calls are transcribed by speech-to-text, then an AI scores politeness and script use.",
    data: "Voice recordings, transcripts, phone number, account details spoken in the call", subjects: "Customers and agents", ai: "Speech-to-text and scoring model", vendor: "Cloud speech vendor (processor)", where: "Vendor cloud, Singapore", xb: 1,
    basis: "Legitimate interest (quality); consent notice at call start", retention: "Recordings 90 days, transcripts 12 months", necessity: "Scoring all calls replaces a sample of 2 percent that was reviewed by hand.",
    screening: ["new-technology", "scoring-monitoring", "large-scale", "vulnerable-subjects"],
    risks: [{ title: "Agents feel watched and scores affect their pay unfairly", description: "Automated scores used for bonus decisions.", l: 3, s: 3, rl: 3, rs: 2,
      controls: [["Scores are coaching input only, not used for pay", "Head of Customer Service", 20, "planned"], ["Agents can see and challenge their own scores", "Service Quality", 40, "planned"]] }] },
  { dept: "Finance & Risk", name: "Credit scoring model",
    purpose: "Decide whether to approve small personal loans in minutes.", description: "A machine learning model scores each application and approves, declines or sends it to an analyst.",
    data: "Income, repayment history, credit bureau data, phone and device signals, address", subjects: "Loan applicants", ai: "Gradient boosting model, trained in-house", vendor: "Credit bureau (data source)", where: "Company data centre, Jakarta", xb: 0,
    basis: "Performance of contract; legal obligation (prudential rules)", retention: "Loan files 10 years", necessity: "Manual review cannot meet the 10-minute service target. Declines above a set score are always reviewed by an analyst.",
    screening: ["automated-decision", "specific-data", "scoring-monitoring", "data-matching", "large-scale", "restricts-rights"],
    dpo: "High risk. Explainability for declined applicants must exist before launch.", signed: "Not yet signed",
    risks: [
      { title: "Applicants are declined unfairly and cannot get a reason", description: "A score with no explanation blocks access to credit.", l: 3, s: 4, rl: 2, rs: 4,
        controls: [["Give every declined applicant the main reasons and a way to appeal", "Head of Credit", 35, "in-progress"], ["Fairness test across age, gender and region before each model update", "Model Risk", 50, "planned"]] },
      { title: "Model drifts and decisions get worse over time", description: "Economic change makes old patterns wrong.", l: 3, s: 3, rl: 2, rs: 3,
        controls: [["Monthly performance and drift report", "Model Risk", 30, "in-progress"]] },
    ] },
  { dept: "Finance & Risk", name: "Transaction fraud detection",
    purpose: "Flag suspicious card and transfer activity in real time.", description: "A model compares each transaction to the customer's normal pattern and known fraud patterns, then blocks or asks for confirmation.",
    data: "Transaction amount, merchant, location, device ID, history", subjects: "Customers", ai: "Anomaly detection model", vendor: "None (in-house)", where: "Company data centre, Jakarta", xb: 0,
    basis: "Legal obligation; legitimate interest (fraud prevention)", retention: "Transaction data 10 years", necessity: "Fraud losses and regulatory duty. Customers can confirm a blocked payment by phone.",
    screening: ["scoring-monitoring", "data-matching", "large-scale"],
    risks: [{ title: "Genuine customers are blocked by mistake", description: "False alarms stop a real purchase or salary transfer.", l: 3, s: 2, rl: 2, rs: 2,
      controls: [["24-hour hotline to unblock a payment", "Fraud Operations", 12, "done"], ["Track the false-alarm rate every week", "Fraud Analytics", 28, "in-progress"]] }] },
  { dept: "Marketing", name: "Personalised offers",
    purpose: "Send each customer the product offers they are most likely to want.", description: "A model combines purchase history and app activity to choose offers for email and push messages.",
    data: "Purchase history, app activity, age band, city", subjects: "Customers", ai: "Recommendation model", vendor: "Marketing platform (processor)", where: "Vendor cloud, Singapore", xb: 1,
    basis: "Consent for marketing messages", retention: "Profiles 24 months after last activity", necessity: "Better targeting means fewer messages per customer. Customers can opt out in the app with one tap.",
    screening: ["scoring-monitoring", "data-matching", "large-scale"],
    risks: [{ title: "Customers are profiled without a clear choice", description: "Opt-out is hard to find or ignored.", l: 3, s: 3, rl: 1, rs: 3,
      controls: [["One-tap opt-out in app settings and in every email", "Marketing Manager", 18, "done"], ["Check the opt-out list before every campaign run", "Marketing Operations", 22, "in-progress"]] }] },
  { dept: "Marketing", name: "Website analytics",
    purpose: "Count visits and see which pages are useful.", description: "Anonymous page-view statistics. No cookies that identify a person, and IP addresses are cut before storage.",
    data: "Page views, country, browser type", subjects: "Website visitors", ai: "None", vendor: "Analytics tool (processor)", where: "Company data centre, Jakarta", xb: 0,
    basis: "Legitimate interest", retention: "26 months", necessity: "Needed to improve the site. No individual is identified.", screening: [], risks: [] },
  { dept: "IT & Security", name: "AI-assisted security monitoring",
    purpose: "Spot unusual logins and data downloads that may signal an attack.", description: "A model reads access logs and raises alerts for the security team. Alerts are checked by an analyst before any action.",
    data: "Login times, device, IP address, files accessed, employee ID", subjects: "Employees and contractors", ai: "Anomaly detection model", vendor: "Security platform (processor)", where: "Vendor cloud, Singapore", xb: 1,
    basis: "Legitimate interest (security); legal obligation", retention: "Logs 12 months", necessity: "Attacks use stolen accounts, which only behaviour monitoring can catch. Only the security team sees names.",
    screening: ["scoring-monitoring", "new-technology", "vulnerable-subjects"],
    risks: [{ title: "Monitoring is used for performance management", description: "Security data is reused to judge staff.", l: 2, s: 3, rl: 1, rs: 3,
      controls: [["Written policy: security logs are never used for performance reviews", "CISO", 15, "done"], ["Restrict name-level access to security analysts", "IT Security", 20, "done"]] }] },
  { dept: "Legal & Compliance", name: "Contract review assistant",
    purpose: "Highlight risky clauses in supplier contracts for lawyers.", description: "An LLM reads contracts and flags clauses against our checklist. Lawyers make every decision.",
    data: "Contract text, names and signatures of contact people", subjects: "Supplier and customer contact people", ai: "Hosted LLM via API", vendor: "Overseas AI vendor (processor)", where: "Vendor cloud, United States", xb: 1,
    basis: "Legitimate interest", retention: "No data kept by the vendor (zero-retention setting)", necessity: "Saves hours per contract. Only a few personal details appear in contracts.",
    screening: ["new-technology"],
    risks: [{ title: "Confidential contract text leaves the company", description: "Terms and personal details go to an overseas processor.", l: 2, s: 3, rl: 1, rs: 3,
      controls: [["Zero-retention setting confirmed in the vendor contract", "Legal Counsel", 10, "done"], ["Redact personal names before upload", "Legal Operations", 30, "planned"]] }] },
];

const iso = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

export const demoLoaded = (db: DatabaseSync) => getSetting(db, "demo_loaded") === "1";

export function loadDemo(db: DatabaseSync): { departments: number; processes: number } {
  if (demoLoaded(db)) return { departments: 0, processes: 0 };
  const dept = new Map<string, number>();
  let created = 0;
  db.exec("BEGIN");
  try {
    for (const name of DEMO_DEPARTMENTS) {
      const found = db.prepare("SELECT id FROM departments WHERE name=?").get(name) as { id: number } | undefined;
      if (found) dept.set(name, found.id);
      else { dept.set(name, Number(db.prepare("INSERT INTO departments (name,demo) VALUES (?,1)").run(name).lastInsertRowid)); created++; }
    }
    for (const a of DEMO) {
      const id = Number(db.prepare(`INSERT INTO activities (department_id,name,purpose,description,data_categories,data_subjects,ai_system,vendor,
        data_location,cross_border,legal_basis,retention,necessity,screening,dpo_advice,subjects_views,signed_by,demo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
        .run(dept.get(a.dept)!, a.name, a.purpose, a.description, a.data, a.subjects, a.ai, a.vendor, a.where, a.xb, a.basis, a.retention, a.necessity,
          JSON.stringify(a.screening), a.dpo ?? "", a.views ?? "", a.signed ?? "").lastInsertRowid);
      for (const r of a.risks) {
        const rid = Number(db.prepare("INSERT INTO risks (activity_id,title,description,likelihood,severity,residual_likelihood,residual_severity) VALUES (?,?,?,?,?,?,?)")
          .run(id, r.title, r.description, r.l, r.s, r.rl ?? null, r.rs ?? null).lastInsertRowid);
        for (const [title, owner, days, status] of r.controls)
          db.prepare("INSERT INTO controls (risk_id,title,owner,due,status) VALUES (?,?,?,?,?)").run(rid, title, owner, iso(days), status);
      }
    }
    setSetting(db, "demo_loaded", "1");
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return { departments: created, processes: DEMO.length };
}

// Removes only what the demo created. A real process added to a demo department keeps that department.
export function removeDemo(db: DatabaseSync): void {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM activities WHERE demo=1").run();
    db.prepare("DELETE FROM departments WHERE demo=1 AND id NOT IN (SELECT department_id FROM activities)").run();
    db.prepare("UPDATE departments SET demo=0 WHERE demo=1").run(); // departments that still hold real work become real
    db.prepare("DELETE FROM tutorial_progress").run();
    setSetting(db, "demo_loaded", "0");
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
