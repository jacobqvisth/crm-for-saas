---
type: project
status: active
tags: [anderson-car-system, personas, workflows, ux]
created: 2025-12-01
updated: 2026-03-20
project: anderson-car-system
---

# Anderson Car System – Personas & Workflows

This document describes key user personas and the workflows that shape the Anderson Car System experience.  
These personas guide UX decisions, workflow design, and AI behavior across the entire application.

---

## 1. Core Personas

Anderson Car System primarily supports three user types inside a workshop:

- **Technicians / Mechanics**  
- **Service Advisors**  
- **Shop Owners / Managers**

Each persona has different goals, environments, constraints, and UX requirements.

---

## 1.1 Technician / Mechanic

### Role
Performs diagnostics, inspections, repairs, and part replacements.  
Works directly on vehicles, often switching between cars throughout the day.

### Behaviors
- Uses tablets or mobile devices near the vehicle  
- Prefers fast scanning and big tap targets  
- Needs clarity and minimal typing  
- Often interrupted — UI must tolerate partial progress  
- Thinks in terms of “what’s next” rather than long forms

### Top Tasks
- View today’s assigned vehicles  
- Run diagnostic sessions  
- Follow repair steps  
- Add notes, photos, test measurements  
- Complete repair items  
- Move jobs between statuses

### Needs
- Speed over aesthetics  
- Predictable layouts  
- Clear priority of actions  
- Quick ways to record findings or measurements  
- AI assistance for unclear cases or unfamiliar issues

---

## 1.2 Service Advisor

### Role
Handles customer intake, communication, estimates, and approvals.

### Behaviors
- Works primarily at a desk, but occasionally enters the workshop  
- Highly structured workflow: intake → estimate → approval  
- Needs forms, validation, and clarity  
- Responsible for communication accuracy and documentation quality

### Top Tasks
- Intake a vehicle and capture concerns  
- Create jobs  
- Build and edit estimates  
- Communicate with customers  
- Track pending approvals and parts  
- Close out jobs after technician work

### Needs
- Fast data entry  
- Keyboard-first form navigation  
- Clear status indicators  
- Templates and AI text generation where appropriate  
- Clean linkage between intake → job → estimate → billing

---

## 1.3 Shop Owner / Manager

### Role
Oversees the entire operation and ensures throughput, quality, and profitability.

### Behaviors
- Uses desktops or tablets  
- Works primarily in dashboards and reporting views  
- Reviews diagnostic summaries and job quality  
- Configures settings, roles, and pricing

### Top Tasks
- Monitor daily workload and cycle times  
- Identify bottlenecks in jobs or diagnostics  
- Review technician performance  
- Set labor rates, taxes, workshop settings  
- Approve or escalate major repairs

### Needs
- High-level clarity  
- Low noise, high signal  
- Reliable data (structured, consistent)  
- Insightful summaries of shop performance  
- Predictive analytics (future)

---

## 2. Primary Workflows

These workflows define how the entire product behaves.  
They are cross-module and reflect real workshop operations.

---

## 2.1 Intake Workflow (Advisor)

1. Customer & vehicle arrive  
2. Advisor logs the intake:  
   - Customer concern (symptoms)  
   - Severity (driveable / not)  
   - Photos / evidence (dashboard lights, damage)  
3. System checks for existing customer and vehicle  
4. A **Job** is created in `draft` status  
5. Intake data auto-populates the first **Diagnostic Session**  
6. Advisor assigns technician or moves job to “diagnosis”

**UX Priorities:**  
- Fast entry  
- Minimal friction  
- Clear defaults  
- Templates for common complaints  
- Automatic linking between customer, vehicle, and job  

---

## 2.2 Diagnostic Workflow (Technician)

1. Open job → start or continue diagnostic session  
2. Enter DTCs, symptoms, notes  
3. AI produces:  
   - Probable causes  
   - Suggested test steps  
   - Recommended repairs  
   - AI summary text  
4. Technician tests components  
5. Add findings or photos  
6. Convert recommended repairs into job line items  
7. Mark diagnostics as complete

**UX Priorities:**  
- Data-dense layout  
- Technician-first clarity  
- Easy conversion to line items  
- Fast access to previous diagnostic sessions  

---

## 2.3 Job / Repair Order Workflow (Advisor + Technician)

1. Job created (via intake or manually)  
2. Complaint → Cause → Correction are clarified  
3. Line items are added:  
   - Labor  
   - Parts  
   - Diagnostics  
   - Fees  
4. Technician completes tasks  
5. Advisor monitors blocking states:  
   - Waiting on customer  
   - Waiting on parts  
   - Waiting on technician  
6. Job is completed and vehicle delivered  
7. Documents and summaries are stored

**UX Priorities:**  
- Clear job timeline  
- Accurate and structured fields  
- Easy transitions between statuses  
- Strong linkage to diagnostics  

---

## 2.4 Estimate Workflow (Advisor)

1. Estimate created from job or from scratch  
2. Add line items and parts  
3. AI suggests additional operations or related repairs  
4. Totals calculated automatically  
5. Advisor sends estimate for customer approval (future enhancement)  
6. Approved estimate becomes part of job execution

---

## 2.5 Inspection Workflow (Technician)

1. Begin inspection  
2. Select checklist or system-area  
3. Capture photos and severity levels  
4. Add notes  
5. Generate inspection report  
6. Attach to job / share with advisor

---

## 2.6 Maintenance Workflow (Advisor + Technician)

1. System shows overdue maintenance  
2. Advisor reviews tasks  
3. Add tasks to job  
4. Generate maintenance report  
5. Future: predictive insights suggest upcoming component failures

---

## 3. Cross-Module Behavior Principles

- **Diagnostics is contextual**: Always tied to a job and vehicle  
- **Vehicle Profile is the central hub**: Diagnoses, jobs, and history gather here  
- **Jobs unify the workflow**: Intake → diagnostics → estimate → repair → delivery  
- **AI assists where ambiguity exists**:  
  - DTC interpretation  
  - Repair suggestions  
  - Customer communication text  
  - Prioritization of tasks  
- **Tech-first UX**: Fast, minimal clicks, high information density  
- **Advisor clarity**: Structured forms, predictable flows  
- **Manager efficiency**: Reporting and insights  

---

*This document evolves over time. Add new personas or workflows as new modules mature.*
