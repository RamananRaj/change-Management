-- ChangeFlow: Phase Content Seed Data
-- Run this in the Supabase SQL Editor
-- Covers: 5 phases, common + 7 industries + 3 roles
-- Content types: exercise, tool, template

-- Clear existing seed data (safe to re-run)
DELETE FROM phase_content WHERE title IS NOT NULL;

-- ---
-- PHASE 1: DIAGNOSE
-- ---

-- COMMON (all industries, all roles)
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES

-- Exercises
(1, NULL, NULL, 'exercise', 'Change Readiness Assessment', 'Survey your organisation to gauge how ready people are for this change. Rate current awareness, desire, knowledge, ability and reinforcement (ADKAR) on a 1–5 scale across key stakeholder groups.', true, 10),
(1, NULL, NULL, 'exercise', 'Stakeholder Mapping Workshop', 'Identify everyone impacted by or influencing the change. Plot them on a power/interest grid to prioritise engagement. Include internal teams, leadership, frontline staff, and external partners.', true, 20),
(1, NULL, NULL, 'exercise', 'Current State Pain Point Interview', 'Conduct structured 30-minute interviews with 5–10 people at different levels. Focus on where the current way of working causes friction, frustration or risk. Document verbatim quotes.', true, 30),

-- Tools
(1, NULL, NULL, 'tool', 'ADKAR Readiness Scorecard', 'Score your organisation across the five ADKAR dimensions: Awareness, Desire, Knowledge, Ability, Reinforcement. Produces a heat map showing where the change is most at risk.', true, 40),
(1, NULL, NULL, 'tool', 'Force Field Analysis', 'List the forces driving the change (pros) and resisting it (cons). Weight each force 1–5. Where resistance outweighs drive, plan targeted interventions before proceeding.', true, 50),
(1, NULL, NULL, 'tool', 'Impact & Effort Matrix', 'Plot proposed change initiatives on a 2×2 grid: high/low impact vs high/low effort. Use this to prioritise quick wins and deprioritise low-value heavy lifts.', true, 60),

-- Templates
(1, NULL, NULL, 'template', 'Change Impact Assessment (CIA)', 'Structured template to document who is affected, how severely, and what they need to change (processes, systems, behaviours, mindsets). Includes a severity rating and recommended action column.', true, 70),
(1, NULL, NULL, 'template', 'Stakeholder Register', 'Master list of all stakeholders with columns for: name, role, department, impact level, current stance, preferred communication channel, key concerns, and accountable owner.', true, 80);

-- FINANCIAL SERVICES — Phase 1
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(1, 'financial-services', NULL, 'exercise', 'Regulatory Impact Analysis', 'Map each element of the change against applicable regulations (APRA, ASIC, Basel III, GDPR etc). Identify compliance obligations that must be met before or during go-live. Flag any approvals needed from the regulator.', false, 110),
(1, 'financial-services', NULL, 'tool', 'Compliance Risk Heatmap', 'Two-axis matrix of regulatory risk (probability × impact) for each change workstream. Used by Risk and Compliance teams to determine which changes need a formal risk assessment lodged.', false, 120),
(1, 'financial-services', NULL, 'template', 'Regulatory Change Register', 'Tracks each regulatory requirement, the relevant change activity, the responsible owner, current compliance status, and the evidence artefact. Approved by Chief Risk Officer before Phase 2.', false, 130);

-- HEALTHCARE — Phase 1
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(1, 'healthcare', NULL, 'exercise', 'Clinical Workflow Impact Mapping', 'Walk end-to-end through each affected clinical pathway with a nurse or clinician. Document every step that will change, who is responsible, and what patient safety risks may emerge during transition.', false, 110),
(1, 'healthcare', NULL, 'tool', 'Patient Safety Risk Assessment', 'Structured risk register specifically for clinical changes. Rates each risk against the Australian Safety and Quality Health Service (ACSQHS) standards. Mandatory sign-off by Clinical Governance before Design.', false, 120),
(1, 'healthcare', NULL, 'template', 'Clinical Change Readiness Checklist', 'Pre-Phase 2 gate checklist covering: executive sponsor confirmed, patient impact documented, union / EBA obligations reviewed, training lead assigned, and IT/clinical systems scope locked.', false, 130);

-- UTILITIES & ENERGY — Phase 1
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(1, 'utilities-energy', NULL, 'exercise', 'Field Operations Impact Assessment', 'Interview field crews, dispatchers and control room operators. Identify which operational procedures, safety protocols, or system interfaces will change. Map the operational risk for each.', false, 110),
(1, 'utilities-energy', NULL, 'tool', 'Network Criticality Matrix', 'Rates each business area on operational criticality (can the grid stay on?). Used to sequence the change rollout so high-criticality areas go last with maximum preparation time.', false, 120),
(1, 'utilities-energy', NULL, 'template', 'Safety Management Change Plan', 'Documents all changes to safety procedures, isolations, lockout-tagout, and emergency response protocols. Requires sign-off from the Safety Manager and HSEQ team before proceeding.', false, 130);

-- TELECOMMUNICATIONS — Phase 1
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(1, 'telecommunications', NULL, 'exercise', 'Network & Platform Dependency Mapping', 'Diagram all network platforms, OSS/BSS systems and third-party integrations touched by the change. Rate each dependency: critical path, nice-to-have, or out-of-scope. Validate with the CTO/Architecture team.', false, 110),
(1, 'telecommunications', NULL, 'tool', 'Customer Experience Impact Tracker', 'Maps each change activity to customer-facing service levels and NPS drivers. Flags any change that could degrade call quality, billing accuracy, or self-serve capability during transition.', false, 120),
(1, 'telecommunications', NULL, 'template', 'Change Scope & Exclusions Register', 'Locks in what is explicitly in-scope and out-of-scope for this change. Prevents scope creep during Design. Signed off by the Programme Director and Architecture Lead.', false, 130);

-- MANUFACTURING — Phase 1
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(1, 'manufacturing', NULL, 'exercise', 'Shop Floor Process Walk', 'Physical walk of each production line with the shift supervisor. Document every step in the process that changes, including safety interlocks, quality checkpoints, and machine interfaces. Take photos.', false, 110),
(1, 'manufacturing', NULL, 'tool', 'OEE Impact Predictor', 'Estimates the short-term drop in Overall Equipment Effectiveness (OEE) during changeover. Helps plan production scheduling, overtime, and buffer stock during the transition window.', false, 120),
(1, 'manufacturing', NULL, 'template', 'Shift Roster & Training Impact Plan', 'Outlines which shifts, lines and crews need to be released for training, in what sequence, without halting production. Signed by Operations Manager and HSE lead.', false, 130);

-- PUBLIC SECTOR — Phase 1
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(1, 'public-sector', NULL, 'exercise', 'Policy & Legislative Alignment Review', 'Map the change against existing legislation, ministerial directives, and departmental policies. Identify any changes that require a policy amendment, regulatory instrument, or ministerial approval.', false, 110),
(1, 'public-sector', NULL, 'tool', 'Union & EBA Obligations Checker', 'Reviews the enterprise bargaining agreement and union consultation obligations. Flags consultation timelines, notice periods, and clauses that restrict how and when changes can be implemented.', false, 120),
(1, 'public-sector', NULL, 'template', 'Ministerial / Executive Briefing Template', 'One-page brief for senior executives or ministers covering: what is changing, why now, who is affected, risk summary, and the recommended next step. Written in plain language.', false, 130);

-- RETAIL & CONSUMER — Phase 1
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(1, 'retail-consumer', NULL, 'exercise', 'Store Network Impact Assessment', 'Segment your store network by format (flagship, regional, convenience). For each segment, document what will change for store managers, department leads, and frontline team members.', false, 110),
(1, 'retail-consumer', NULL, 'tool', 'Peak Trading Calendar', 'Overlays the change rollout timeline against peak trade periods (Christmas, EOFY, Back to School). Ensures no major change activities land during blackout periods that would distract teams.', false, 120),
(1, 'retail-consumer', NULL, 'template', 'Customer Impact Statement', 'Documents how customers may be affected during transition (e.g., product availability, service changes, loyalty programme disruption). Used by Marketing and Customer Experience to plan comms.', false, 130);

-- ROLE-SPECIFIC — Phase 1
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
-- Change Manager
(1, NULL, 'cm', 'exercise', 'Organisational Culture Scan', 'Use a structured questionnaire to identify the dominant cultural traits (hierarchical, collaborative, risk-averse etc). Map how the change aligns or conflicts with the current culture. This shapes your engagement approach.', false, 210),
(1, NULL, 'cm', 'tool', 'Change History Timeline', 'Document the last 3–5 major changes the organisation has been through. Note what went well, what failed, and how change fatigue is currently scoring. Use this to calibrate communication tone.', false, 220),

-- Product Owner
(1, NULL, 'po', 'exercise', 'User Story Impact Analysis', 'For every existing user story in your backlog, flag which ones are affected by the change. Identify stories that need to be updated, retired, or created from scratch. Prioritise in the next sprint.', false, 210),
(1, NULL, 'po', 'tool', 'Product Roadmap Alignment Check', 'Overlay the change timeline against your product roadmap. Identify conflicts where a feature release and a change activity land simultaneously on the same team. Negotiate sequencing early.', false, 220),

-- Project Manager
(1, NULL, 'pm', 'exercise', 'Dependency & Critical Path Mapping', 'List all workstreams, their owners, and the dependencies between them. Build a critical path. Identify which activities cannot slip without delaying go-live. Use this to focus your risk conversations.', false, 210),
(1, NULL, 'pm', 'tool', 'RAID Log (Risks, Assumptions, Issues, Dependencies)', 'Initialise your RAID log at the start of Phase 1. Populate the first round of risks and assumptions. Review weekly. Every risk should have a likelihood, impact score, and a named owner.', false, 220);


-- ---
-- PHASE 2: DESIGN
-- ---

-- COMMON
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(2, NULL, NULL, 'exercise', 'Future State Process Design Workshop', 'Bring together key stakeholders for a half-day workshop to map the desired future state. Use sticky notes to map each step, owner, and system touchpoint. Compare to current state and highlight the delta.', true, 10),
(2, NULL, NULL, 'exercise', 'Change Impact Deep Dive', 'For each impacted group identified in Phase 1, detail: what they need to stop, start, and continue doing; what skills they need; and what systems will change. Group impacts by severity.', true, 20),
(2, NULL, NULL, 'tool', 'Change Management Strategy', 'One-page strategy document outlining: scope, objectives, guiding principles, key audiences, engagement approach, training approach, and success measures. Signed off by the executive sponsor.', true, 30),
(2, NULL, NULL, 'tool', 'Communication Planning Canvas', 'Maps each audience to the right messages, messengers, channels and timing. Think of this as the master comms brief — everything in your detailed comms plan should trace back to this canvas.', true, 40),
(2, NULL, NULL, 'template', 'Change Management Plan', 'Full plan covering: change history, scope, stakeholder analysis, impact summary, communication strategy, training approach, resistance management, readiness criteria, and milestone schedule.', true, 50),
(2, NULL, NULL, 'template', 'Training Needs Analysis (TNA)', 'Documents each impacted group, the current skill/knowledge level, the desired level, the gap, and the recommended training solution (e-learning, workshop, job aid, coaching etc). Estimates effort per person.', true, 60);

-- Financial Services — Phase 2
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(2, 'financial-services', NULL, 'exercise', 'Controls & Audit Design Review', 'With Risk and Internal Audit, design the new controls required to maintain compliance post-change. Document control owner, frequency, evidence type, and the risk it mitigates. Map to existing control framework.', false, 110),
(2, 'financial-services', NULL, 'template', 'Regulatory Notification Package', 'Pre-prepared notification to relevant regulators (APRA/ASIC) where required. Includes change description, effective date, risk assessment, and attestation from the CRO. Legal review required.', false, 120);

-- Healthcare — Phase 2
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(2, 'healthcare', NULL, 'exercise', 'Clinical Simulation Design', 'Design a clinical simulation exercise to test the new process in a safe environment before go-live. Define the scenario, patient profile, expected steps, and how you will observe and measure performance.', false, 110),
(2, 'healthcare', NULL, 'template', 'Clinical Education Plan', 'Documents the education strategy for clinical staff: who needs what training, by when, in what format (competency assessment, observed practice, e-module), and who signs off competency.', false, 120);

-- Manufacturing — Phase 2
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(2, 'manufacturing', NULL, 'tool', 'Standard Operating Procedure (SOP) Revision Register', 'Tracks every SOP that needs to be created, updated or retired as a result of the change. Includes document owner, current revision, target revision, review date, and approval status.', false, 110),
(2, 'manufacturing', NULL, 'template', 'Operator Training Matrix', 'Maps each operator to the tasks they are currently certified for and the new certifications required. Used by the Training Coordinator to plan station rotation and skills assessment scheduling.', false, 120);

-- Public Sector — Phase 2
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(2, 'public-sector', NULL, 'exercise', 'Union Consultation Facilitation Guide', 'Structured agenda for the formal consultation meeting with union representatives. Includes: presenting the change, recording union concerns, negotiating implementation timing, and documenting outcomes.', false, 110),
(2, 'public-sector', NULL, 'template', 'Business Case Addendum (Change Management Section)', 'Adds the change management cost, approach and success measures to the existing business case. Required for Treasury / Finance approval on projects over the spending threshold.', false, 120);

-- ROLE-SPECIFIC — Phase 2
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(2, NULL, 'cm', 'tool', 'Resistance Management Plan', 'Anticipates sources of resistance (by group, level, and type). Plans targeted interventions: leader conversations, peer champions, coaching, incentives. Tracks resistance level before and after each intervention.', false, 210),
(2, NULL, 'po', 'tool', 'Definition of Done — Change Readiness Gate', 'Adds a "change ready" criterion to your Definition of Done. Before a feature ships, the impacted teams must have: received comms, completed training, and confirmed readiness. Prevents big-bang change at go-live.', false, 210),
(2, NULL, 'pm', 'template', 'Integrated Project & Change Plan', 'Merges the project schedule (milestones, delivery dates) with the change schedule (comms, training, readiness checks). Single source of truth for the programme. Reviewed weekly at project governance.', false, 210);


-- ---
-- PHASE 3: ENGAGE
-- ---

-- COMMON
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(3, NULL, NULL, 'exercise', 'Leadership Alignment Session', 'Half-day session with senior leaders to: align on the case for change, calibrate the engagement approach, practice their key messages, and agree on visible sponsorship actions they will each take.', true, 10),
(3, NULL, NULL, 'exercise', 'Change Champion Network Launch', 'Recruit 1–2 change champions per business unit. Run a 2-hour launch workshop to brief them on the change, their role, and the key messages. Give them a toolkit and a feedback channel back to the core team.', true, 20),
(3, NULL, NULL, 'tool', 'Communication Delivery Tracker', 'Logs every communication sent: date, channel, audience, message, owner, open rate (if email), and feedback received. Reviewed weekly to spot gaps in reach or comprehension.', true, 30),
(3, NULL, NULL, 'tool', 'Pulse Check Survey', '5-question survey sent monthly to all impacted staff. Measures: awareness of the change, understanding of what is required, confidence in their ability to do it, and trust in leadership. Results presented at governance.', true, 40),
(3, NULL, NULL, 'template', 'Stakeholder Engagement Plan', 'Detailed plan per stakeholder group: engagement objective, activities, frequency, owner, key messages, and how you will know engagement has worked. Links back to the Stakeholder Register from Phase 1.', true, 50),
(3, NULL, NULL, 'template', 'Change Champion Toolkit', 'Ready-to-use pack for champions: key messages, FAQ sheet, conversation guide, feedback form, and an escalation path for issues they cannot resolve locally. Refreshed at each major milestone.', true, 60);

-- Financial Services — Phase 3
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(3, 'financial-services', NULL, 'exercise', 'Branch / Team Roadshow', 'Deliver 30-minute town hall sessions at each business unit or branch. Cover: why the change is happening, what will be different, what support is available, and Q&A. Capture questions for the FAQ bank.', false, 110),
(3, 'financial-services', NULL, 'template', 'Regulatory Comms Package', 'Pre-approved communication to customers and counterparties about changes to products, services or processes. Reviewed by Legal and Compliance before release. Includes opt-out instructions where required by law.', false, 120);

-- Healthcare — Phase 3
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(3, 'healthcare', NULL, 'exercise', 'Clinical Peer Champion Program', 'Identify respected senior clinicians (nurses, doctors, allied health) who will model the new way of working. Brief them first. Give them peer-to-peer conversation guides so they can influence their colleagues naturally.', false, 110),
(3, 'healthcare', NULL, 'template', 'Patient & Family Communication Plan', 'For changes that affect the patient experience, documents: what patients need to know, when, how (letter, portal, face-to-face), who signs it off, and how patient feedback will be monitored.', false, 120);

-- Retail & Consumer — Phase 3
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(3, 'retail-consumer', NULL, 'exercise', 'Store Manager Cascade Workshop', 'Equip store managers to deliver the change message to their teams. Run a half-day train-the-trainer session. Give them a scripted briefing guide, a Q&A sheet, and a way to escalate questions they cannot answer.', false, 110),
(3, 'retail-consumer', NULL, 'template', 'Frontline Team Member FAQ', 'Plain-language FAQ written at a Year 9 reading level. Covers the 10 most common questions from frontline staff. Updated after each round of store visits as new questions surface.', false, 120);

-- ROLE-SPECIFIC — Phase 3
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(3, NULL, 'cm', 'exercise', 'Resistance Hotspot Intervention', 'Using pulse check data, identify the 2–3 groups showing lowest readiness or highest resistance. Design a targeted intervention (e.g., leader conversation, peer forum, hands-on demo) and measure the shift 30 days later.', false, 210),
(3, NULL, 'po', 'exercise', 'Sprint Demo as Change Communication', 'Use your regular sprint demo as a change engagement tool. Invite impacted business stakeholders. Frame the demo around "here is what will be different for you." Collect feedback and feed it into the next sprint.', false, 210),
(3, NULL, 'pm', 'tool', 'Engagement Progress Dashboard', 'Tracks engagement activity completion by team / region / department. Shows: comms sent vs planned, training completed vs planned, champion network coverage, and pulse check scores. Updated weekly.', false, 210);


-- ---
-- PHASE 4: EMBED
-- ---

-- COMMON
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(4, NULL, NULL, 'exercise', 'Go-Live Readiness Assessment', '48-hour pre-go-live checklist: comms complete, training complete, systems tested, hyper-care team briefed, escalation paths documented, support resources published, and executive sponsor signed off.', true, 10),
(4, NULL, NULL, 'exercise', 'Hyper-Care Support Sprint', 'Intensive 2-week period immediately post-go-live. Daily stand-up with the change team, project team, and business leads. Issues logged and resolved within 24 hours. Champion network activated as first point of contact.', true, 20),
(4, NULL, NULL, 'tool', 'Benefits Realisation Tracker', 'Links each business benefit (from the original business case) to a measurable KPI, a baseline, a target, and a measurement date. Reviewed monthly by the executive sponsor for the first 6 months post-go-live.', true, 30),
(4, NULL, NULL, 'tool', 'Adoption Monitoring Dashboard', 'Tracks system login rates, process compliance, and error rates in the first 90 days post-go-live. Used to spot teams that are reverting to old behaviours and trigger targeted reinforcement.', true, 40),
(4, NULL, NULL, 'template', 'Reinforcement Plan', 'Documents how the organisation will cement the change: leader check-ins, performance KPIs updated, incentives aligned, non-compliance consequences, and a 90-day adoption review milestone.', true, 50),
(4, NULL, NULL, 'template', 'Hyper-Care Runbook', 'Day-by-day guide for the hyper-care team: who is on call, how to log issues, escalation thresholds, communication triggers (when to escalate to exec), and the criteria to exit hyper-care.', true, 60);

-- Financial Services — Phase 4
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(4, 'financial-services', NULL, 'tool', 'Post-Implementation Controls Test', 'Validates that all new controls are operating as designed in the first 30 days. Tests include: sample transaction reviews, reconciliation checks, and exception report analysis. Results to Internal Audit.', false, 110),
(4, 'financial-services', NULL, 'template', 'Regulatory Post-Implementation Report', 'Formal report to the regulator (where required) confirming: change implemented as notified, controls validated, no material adverse outcomes, and ongoing monitoring plan in place.', false, 120);

-- Healthcare — Phase 4
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(4, 'healthcare', NULL, 'exercise', 'Clinical Competency Sign-Off Round', 'Each clinical staff member is observed performing the new process by a senior clinician or educator. Competency recorded in the training system. Any gaps trigger a targeted re-education session within 5 days.', false, 110),
(4, 'healthcare', NULL, 'tool', 'Patient Safety Incident Monitor', 'Tracks any clinical incidents in the first 60 days that could be related to the change. Reviewed at the weekly safety huddle. Any sentinel event triggers an immediate incident review and change team notification.', false, 120);

-- Public Sector — Phase 4
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(4, 'public-sector', NULL, 'template', 'Post-Implementation Review Brief (for Minister)', 'One-page brief to the minister / secretary confirming the change has been implemented, headline outcomes, any issues and how they were resolved, and the ongoing monitoring plan.', false, 110);

-- ROLE-SPECIFIC — Phase 4
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(4, NULL, 'cm', 'exercise', '30-60-90 Day Adoption Check-Ins', 'Structured conversations at 30, 60 and 90 days post-go-live with team leaders and champions. Use the same 5 questions each time to measure movement. Report results to the executive sponsor with recommended actions.', false, 210),
(4, NULL, 'po', 'exercise', 'Post-Launch Retrospective', 'Standard agile retrospective framed around the change: What did users find easy? What is still confusing? What do we need to fix in the next sprint? Feed outcomes into the product backlog immediately.', false, 210),
(4, NULL, 'pm', 'tool', 'Issue & Benefit Realisation Log', 'Single log tracking both outstanding post-go-live issues (with owner and due date) and benefits achieved vs. planned (with evidence). Presented at the project steering committee until formal project closure.', false, 210);


-- ---
-- PHASE 5: EVALUATE
-- ---

-- COMMON
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(5, NULL, NULL, 'exercise', 'Post-Implementation Review (PIR) Workshop', 'Half-day workshop at 90 days post-go-live. Bring together the change team, project team, and senior stakeholders. Review: what went well, what did not, what would we do differently, and what lessons should be captured.', true, 10),
(5, NULL, NULL, 'exercise', 'Benefits Realisation Review', 'Formal review of each benefit in the benefits tracker. Has the target been met? If not, why not, and what corrective action is needed? Present findings to the executive sponsor and programme board.', true, 20),
(5, NULL, NULL, 'tool', 'Change Maturity Scorecard', 'Rates the organisation on five dimensions of change capability: leadership, methodology, skills, tools, and culture. Compare score to Phase 1 baseline. Use the gap to build the next change capability improvement plan.', true, 30),
(5, NULL, NULL, 'tool', 'Lessons Learned Register', 'Structured log of lessons from the full project lifecycle: what worked, what did not, root cause, and recommendation for future projects. Stored in the knowledge base and shared at the next change community of practice.', true, 40),
(5, NULL, NULL, 'template', 'Post-Implementation Review Report', 'Formal written report covering: scope recap, what was achieved, KPI outcomes vs targets, stakeholder feedback, issues log status, lessons learned, and recommendations. Signed off by the executive sponsor.', true, 50),
(5, NULL, NULL, 'template', 'Change Capability Assessment Report', 'Benchmarks the organisation on change capability before and after the programme. Includes individual skill assessments for the change team, maturity scores, and a 12-month development plan.', true, 60);

-- Financial Services — Phase 5
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(5, 'financial-services', NULL, 'tool', 'Regulatory Outcomes Report', 'Documents compliance outcomes: number of breaches (if any), regulatory feedback received, controls audit results, and a forward-looking attestation that the business is operating within its risk appetite.', false, 110),
(5, 'financial-services', NULL, 'template', 'Board & Audit Committee Pack (Change Outcomes)', 'Board-ready summary of the change: business case achievement, risk outcomes, regulatory status, and any residual risks being managed. Written at executive level with supporting data appendix.', false, 120);

-- Healthcare — Phase 5
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(5, 'healthcare', NULL, 'exercise', 'Clinical Outcome Measurement Review', 'Compare pre- and post-change clinical outcome data (where available): patient wait times, adverse event rates, staff compliance rates. Present findings at the Quality and Safety Committee.', false, 110),
(5, 'healthcare', NULL, 'template', 'Clinical Governance Sign-Off Report', 'Formal sign-off from the Clinical Governance Committee confirming the change has been implemented safely, staff are competent, patient outcomes are being monitored, and the change is embedded in standard practice.', false, 120);

-- Retail & Consumer — Phase 5
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(5, 'retail-consumer', NULL, 'tool', 'Store Performance Comparison (Pre/Post)', 'Compares key store metrics 90 days before and 90 days after go-live: conversion rate, ATV, shrinkage, NPS, absenteeism. Used to validate that the change delivered the expected business outcome.', false, 110),
(5, 'retail-consumer', NULL, 'template', 'Field Leadership Debrief Report', 'Captures feedback from area managers and store managers on how the change landed: what worked, what support was missing, and what they would change. Used to improve the next retail rollout.', false, 120);

-- ROLE-SPECIFIC — Phase 5
INSERT INTO phase_content (phase_number, industry, role, content_type, title, description, is_common, sort_order) VALUES
(5, NULL, NULL, 'exercise', 'Change Team Capability Debrief', 'Structured reflection for the change team: what did each person learn, what skills did they develop, what would they do differently next time? Feeds into individual development plans and the team capability roadmap.', true, 70),
(5, NULL, 'cm', 'template', 'Change Manager Professional Development Plan', 'Based on the capability debrief, documents each change manager''s development goals for the next 12 months: skills to build, certifications to pursue, and mentoring or coaching arrangements.', false, 210),
(5, NULL, 'po', 'tool', 'Feature Adoption Analytics Report', 'Data-driven report on feature adoption rates in the first 90 days post-launch. Includes: active user rates, feature utilisation heatmap, support ticket trends, and NPS/CSAT scores. Input to next roadmap cycle.', false, 210),
(5, NULL, 'pm', 'template', 'Project Closure Report', 'Formal project closure document: scope delivered, budget final, schedule performance, benefits achieved, issues resolved, lessons learned, and recommended post-project monitoring plan. Signed by the Project Sponsor.', false, 210);

-- Final count check
SELECT phase_number, content_type, COUNT(*) as count
FROM phase_content
GROUP BY phase_number, content_type
ORDER BY phase_number, content_type;
