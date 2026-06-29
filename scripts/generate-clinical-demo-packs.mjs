#!/usr/bin/env node
import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { removeTree, rootDir } from "./harness-core.mjs";

const domains = [
  "demographics",
  "visits",
  "labs",
  "vitals",
  "adverse_events",
  "concomitant_meds",
  "exposure",
];

const addDays = (dateText, days) => {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const csvValue = (value) => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const writeCsv = async (targetPath, headers, rows) => {
  await writeFile(
    targetPath,
    `${headers.join(",")}\n${rows.map((row) => headers.map((header) => csvValue(row[header])).join(",")).join("\n")}\n`,
  );
};

const subjectId = (index) => `SUBJ-${String(index).padStart(3, "0")}`;

const scenarioTerms = {
  "subject-profile": [
    ["Headache", "Nervous system disorders"],
    ["Nausea", "Gastrointestinal disorders"],
    ["Alanine aminotransferase increased", "Investigations"],
    ["Fatigue", "General disorders"],
    ["Rash", "Skin disorders"],
  ],
  oncology: [
    ["Neutropenia", "Blood and lymphatic system disorders"],
    ["Nausea", "Gastrointestinal disorders"],
    ["Alanine aminotransferase increased", "Investigations"],
    ["Peripheral neuropathy", "Nervous system disorders"],
    ["Fatigue", "General disorders"],
  ],
  vaccine: [
    ["Injection site pain", "General disorders"],
    ["Pyrexia", "General disorders"],
    ["Headache", "Nervous system disorders"],
    ["Myalgia", "Musculoskeletal disorders"],
    ["Chills", "General disorders"],
  ],
  chronic: [
    ["Hypertension", "Vascular disorders"],
    ["Dizziness", "Nervous system disorders"],
    ["Peripheral edema", "General disorders"],
    ["Alanine aminotransferase increased", "Investigations"],
    ["Fatigue", "General disorders"],
  ],
};

const scenarioArms = {
  "subject-profile": ["Active", "Control"],
  oncology: ["Investigational", "Standard of care"],
  vaccine: ["Vaccine", "Placebo"],
  chronic: ["Active", "Comparator"],
};

const generatePack = ({ id, scenario, count, description }) => {
  const terms = scenarioTerms[scenario];
  const arms = scenarioArms[scenario];
  const demographics = [];
  const visits = [];
  const labs = [];
  const vitals = [];
  const adverse_events = [];
  const concomitant_meds = [];
  const exposure = [];

  for (let index = 1; index <= count; index += 1) {
    const idText = subjectId(index);
    const active = index % 3 !== 2;
    const arm = active ? arms[0] : arms[1];
    const sex = index % 2 === 1 ? "F" : "M";
    const age = index === 1 ? 54 : 38 + ((index * 7) % 35);
    const region = ["North America", "Europe", "Asia Pacific"][index % 3];
    const site = ["SITE-101", "SITE-203", "SITE-305", "SITE-407"][index % 4];
    const firstDoseDate = addDays("2025-01-10", index === 1 ? 0 : index * 2);
    const consentDate = addDays(firstDoseDate, -7 - (index % 3));
    const discontinued = index % 11 === 0 || index % 17 === 0;
    const lastContactDate = addDays(firstDoseDate, discontinued ? 63 : 91);

    demographics.push({
      subject_id: idText,
      site_id: site,
      arm,
      sex,
      age,
      race: index === 1 ? "Asian" : ["White", "Asian", "Black or African American", "Other"][index % 4],
      ethnicity: index % 5 === 0 ? "Hispanic or Latino" : "Not Hispanic or Latino",
      region,
      baseline_weight_kg: (56 + ((index * 5) % 38) + (sex === "M" ? 8 : 0)).toFixed(1),
      baseline_bmi: (21 + ((index * 1.7) % 9)).toFixed(1),
      consent_date: consentDate,
      first_dose_date: firstDoseDate,
      last_contact_date: lastContactDate,
      study_status: discontinued ? "Discontinued" : "On study",
    });

    const visitPlan = [
      ["Screening", -7, "Eligible"],
      ["Baseline", 1, "Dosed"],
      ["Week 2", 15, "On treatment"],
      ["Week 4", 29, "On treatment"],
      ["Week 8", 57, discontinued ? "Discontinued" : "On treatment"],
      ["Week 12", 85, discontinued ? "Not reached" : "On treatment"],
    ];
    for (const [visit, visitDay, disposition] of visitPlan) {
      if (discontinued && visitDay > 57) {
        continue;
      }
      visits.push({
        subject_id: idText,
        visit,
        visit_day: visitDay,
        visit_date: addDays(firstDoseDate, visitDay - 1),
        visit_status: index % 13 === 0 && visit === "Week 4" ? "Missed" : "Completed",
        disposition,
      });
    }

    const altBase = index === 1 ? 28 : 20 + ((index * 3) % 22);
    const altHigh = index === 1 || index % 4 === 0 || index % 7 === 0;
    const altValues = [
      altBase,
      altBase + (altHigh ? 8 : 2),
      altBase + (altHigh ? 24 : 4),
      altBase + (altHigh ? 18 : 5),
      altBase + (altHigh ? 9 : 3),
    ];
    const labVisits = visits.filter((row) => row.subject_id === idText && row.visit !== "Screening");
    for (const [labIndex, visit] of labVisits.entries()) {
      const alt = altValues[Math.min(labIndex, altValues.length - 1)];
      labs.push({
        subject_id: idText,
        visit: visit.visit,
        visit_day: visit.visit_day,
        lab_test: "ALT",
        lab_value: alt,
        unit: "U/L",
        low: 0,
        high: 45,
        flag: alt > 45 ? "High" : "Normal",
      });
      labs.push({
        subject_id: idText,
        visit: visit.visit,
        visit_day: visit.visit_day,
        lab_test: "HGB",
        lab_value: (sex === "F" ? 12.4 : 13.4 + ((index + labIndex) % 3) * 0.2).toFixed(1),
        unit: "g/dL",
        low: sex === "F" ? 11.5 : 12.5,
        high: sex === "F" ? 15.5 : 17,
        flag: "Normal",
      });
    }

    for (const visit of labVisits.filter((row) => ["Baseline", "Week 4", "Week 8", "Week 12"].includes(row.visit))) {
      vitals.push({
        subject_id: idText,
        visit: visit.visit,
        visit_day: visit.visit_day,
        systolic_bp: 112 + ((index * 3 + Number(visit.visit_day)) % 34),
        diastolic_bp: 68 + ((index * 2 + Number(visit.visit_day)) % 18),
        heart_rate: 62 + ((index * 5 + Number(visit.visit_day)) % 28),
        temperature_c: (36.4 + ((index + Number(visit.visit_day)) % 8) / 10).toFixed(1),
        weight_kg: (Number(demographics.at(-1).baseline_weight_kg) - Number(visit.visit_day) / 90).toFixed(1),
      });
    }

    const cycles = discontinued ? 2 : 3;
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      const reduced = active && (index % 7 === 0 || index % 11 === 0) && cycle === 2;
      exposure.push({
        subject_id: idText,
        cycle,
        start_day: 1 + (cycle - 1) * 28,
        end_day: cycle * 28,
        dose_mg: active ? (reduced ? 75 : 100) : 0,
        dose_status: active ? (reduced ? "Dose reduced" : "Completed") : "Control",
        dose_intensity_pct: active ? (reduced ? 78 : 96 + (index % 5)) : 100,
      });
    }

    if (index === 1 && scenario === "subject-profile") {
      adverse_events.push(
        {
          subject_id: idText,
          ae_id: "AE-001",
          ae_term: "Headache",
          system_organ_class: "Nervous system disorders",
          start_day: 9,
          end_day: 11,
          severity: "Mild",
          serious: "N",
          related: "Possible",
          outcome: "Resolved",
        },
        {
          subject_id: idText,
          ae_id: "AE-002",
          ae_term: "Nausea",
          system_organ_class: "Gastrointestinal disorders",
          start_day: 18,
          end_day: 22,
          severity: "Moderate",
          serious: "N",
          related: "Probable",
          outcome: "Resolved",
        },
        {
          subject_id: idText,
          ae_id: "AE-003",
          ae_term: "Alanine aminotransferase increased",
          system_organ_class: "Investigations",
          start_day: 30,
          end_day: 60,
          severity: "Moderate",
          serious: "N",
          related: "Possible",
          outcome: "Resolving",
        },
      );
    } else {
      const aeCount = index % 5 === 0 ? 0 : 1 + (index % 3);
      for (let aeIndex = 1; aeIndex <= aeCount; aeIndex += 1) {
        const [term, soc] = terms[(index + aeIndex) % terms.length];
        const start = 8 + aeIndex * 8 + (index % 6);
        const serious = index % 11 === 0 && aeIndex === aeCount ? "Y" : "N";
        adverse_events.push({
          subject_id: idText,
          ae_id: `AE-${String(adverse_events.length + 1).padStart(3, "0")}`,
          ae_term: term,
          system_organ_class: soc,
          start_day: start,
          end_day: serious === "Y" ? start + 27 : start + 2 + (index % 5),
          severity: serious === "Y" ? "Severe" : aeIndex === 1 ? "Mild" : "Moderate",
          serious,
          related: active ? ["Possible", "Probable", "Unrelated"][aeIndex % 3] : "Unrelated",
          outcome: serious === "Y" && discontinued ? "Discontinued" : aeIndex === aeCount ? "Resolving" : "Resolved",
        });
      }
    }

    concomitant_meds.push({
      subject_id: idText,
      medication: index % 2 === 0 ? "Atorvastatin" : "Multivitamin",
      indication: index % 2 === 0 ? "Hyperlipidemia" : "Supplement",
      start_day: index % 2 === 0 ? -180 : -30,
      end_day: "",
      ongoing: "Y",
    });
    if (adverse_events.some((row) => row.subject_id === idText && row.ae_term === "Nausea")) {
      concomitant_meds.push({
        subject_id: idText,
        medication: "Ondansetron",
        indication: "Nausea",
        start_day: 18,
        end_day: 22,
        ongoing: "N",
      });
    }
  }

  return {
    metadata: {
      id,
      version: "1.1.0",
      synthetic: true,
      scenario,
      subjectCount: count,
      description,
      domains,
      primarySubject: "SUBJ-001",
    },
    demographics,
    visits,
    labs,
    vitals,
    adverse_events,
    concomitant_meds,
    exposure,
  };
};

const writePack = async (targetDir, pack) => {
  await removeTree(targetDir);
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, "clinical-demo-data-pack.json"), `${JSON.stringify(pack.metadata, null, 2)}\n`);
  await writeCsv(
    path.join(targetDir, "demographics.csv"),
    [
      "subject_id",
      "site_id",
      "arm",
      "sex",
      "age",
      "race",
      "ethnicity",
      "region",
      "baseline_weight_kg",
      "baseline_bmi",
      "consent_date",
      "first_dose_date",
      "last_contact_date",
      "study_status",
    ],
    pack.demographics,
  );
  await writeCsv(path.join(targetDir, "visits.csv"), ["subject_id", "visit", "visit_day", "visit_date", "visit_status", "disposition"], pack.visits);
  await writeCsv(path.join(targetDir, "labs.csv"), ["subject_id", "visit", "visit_day", "lab_test", "lab_value", "unit", "low", "high", "flag"], pack.labs);
  await writeCsv(
    path.join(targetDir, "vitals.csv"),
    ["subject_id", "visit", "visit_day", "systolic_bp", "diastolic_bp", "heart_rate", "temperature_c", "weight_kg"],
    pack.vitals,
  );
  await writeCsv(
    path.join(targetDir, "adverse_events.csv"),
    ["subject_id", "ae_id", "ae_term", "system_organ_class", "start_day", "end_day", "severity", "serious", "related", "outcome"],
    pack.adverse_events,
  );
  await writeCsv(
    path.join(targetDir, "concomitant_meds.csv"),
    ["subject_id", "medication", "indication", "start_day", "end_day", "ongoing"],
    pack.concomitant_meds,
  );
  await writeCsv(
    path.join(targetDir, "exposure.csv"),
    ["subject_id", "cycle", "start_day", "end_day", "dose_mg", "dose_status", "dose_intensity_pct"],
    pack.exposure,
  );
};

const generated = [
  {
    id: "clinical-demo-subject-profile-v1",
    scenario: "subject-profile",
    count: 30,
    description: "Synthetic clinical subject profile data for harness verification, report export, and demos.",
  },
  {
    id: "clinical-demo-oncology-safety-v1",
    scenario: "oncology",
    count: 36,
    description: "Synthetic oncology safety scenario data pack with lab abnormalities and dose modifications.",
  },
  {
    id: "clinical-demo-vaccine-reactogenicity-v1",
    scenario: "vaccine",
    count: 32,
    description: "Synthetic vaccine reactogenicity scenario data pack for short-window safety review demos.",
  },
  {
    id: "clinical-demo-chronic-disease-v1",
    scenario: "chronic",
    count: 34,
    description: "Synthetic chronic disease scenario data pack with longitudinal exposure and safety follow-up.",
  },
];

for (const spec of generated) {
  const pack = generatePack(spec);
  await writePack(path.join(rootDir, "data-packs", spec.id), pack);
}

await cp(
  path.join(rootDir, "data-packs", "clinical-demo-subject-profile-v1"),
  path.join(rootDir, "shinylive-src", "subject-profile-reference", "data"),
  { recursive: true, force: true },
);
await cp(
  path.join(rootDir, "data-packs", "clinical-demo-subject-profile-v1"),
  path.join(rootDir, "templates", "apps", "subject-profile-reference", "data"),
  { recursive: true, force: true },
);

console.log(
  JSON.stringify(
    {
      ok: true,
      generated: generated.map((spec) => ({ id: spec.id, scenario: spec.scenario, subjectCount: spec.count })),
    },
    null,
    2,
  ),
);
