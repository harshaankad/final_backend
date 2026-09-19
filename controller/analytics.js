const Patient = require("../models/patient");
const Report = require("../models/report");
const Doctor = require("../models/doctor");

// ---------------------------------------------------------------------------
// Admin analytics
//
// A "submission" is a patient whose payment completed. Reports mark a submission
// as done. Everything is computed in Node from lean documents: the dataset is a
// single clinic's, so this stays simple and easy to change.
// ---------------------------------------------------------------------------

const RANGES = {
  "30d": { days: 30, bucket: "day" },
  "90d": { days: 90, bucket: "day" },
  "12m": { days: 365, bucket: "month" },
  all: { days: null, bucket: "month" },
};

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

// Every bucket between from and to, so charts show zero-days instead of gaps.
const buildBuckets = (from, to, bucket) => {
  const keys = [];
  if (bucket === "day") {
    for (let d = startOfDay(from); d <= to; d = new Date(d.getTime() + DAY_MS)) keys.push(dayKey(d));
  } else {
    for (let d = startOfMonth(from); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) keys.push(monthKey(d));
  }
  return keys;
};

const bucketKeyFor = (date, bucket) => (bucket === "day" ? dayKey(date) : monthKey(date));

const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const mean = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

const countBy = (items, keyFn) => {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
};

const sortedEntries = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));

const ageBand = (age) => {
  if (age == null || Number.isNaN(age)) return "Unknown";
  if (age < 18) return "0–17";
  if (age < 30) return "18–29";
  if (age < 45) return "30–44";
  if (age < 60) return "45–59";
  return "60+";
};

const TURNAROUND_BUCKETS = [
  { key: "< 1 day", max: 24 },
  { key: "1–2 days", max: 48 },
  { key: "2–3 days", max: 72 },
  { key: "3–7 days", max: 168 },
  { key: "> 7 days", max: Infinity },
];

const doctorName = (doc) => {
  if (!doc) return "Unknown";
  const name = `${doc.firstname || ""} ${doc.lastname || ""}`.trim();
  return name ? `Dr. ${name}` : doc.email || "Unknown";
};

exports.getAnalytics = async (req, res) => {
  try {
    const rangeKey = RANGES[req.query.range] ? req.query.range : "30d";
    const { days, bucket } = RANGES[rangeKey];

    const to = new Date();
    let from;
    if (days) {
      from = startOfDay(new Date(to.getTime() - (days - 1) * DAY_MS));
    } else {
      const first = await Patient.findOne({}, { createdAt: 1 }).sort({ createdAt: 1 }).lean();
      from = startOfMonth(first ? first.createdAt : to);
    }
    const spanMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - spanMs);
    const prevTo = from;

    // Pull once, filter in memory (window + previous window for deltas).
    const [patients, reports, doctors] = await Promise.all([
      Patient.find(
        { createdAt: { $gte: prevFrom } },
        { doctor: 1, firstname: 1, lastname: 1, age: 1, gender: 1, siteOfInfection: 1, status: 1, paymentStatus: 1, amountPaid: 1, paymentDate: 1, createdAt: 1 }
      )
        .populate("doctor", "firstname lastname email")
        .lean(),
      Report.find({ createdAt: { $gte: prevFrom } }, { patient: 1, doctor: 1, createdAt: 1 }).lean(),
      Doctor.find({ role: "doctor" }, { firstname: 1, lastname: 1, email: 1, howDoYouKnowAdmin: 1, _id: 1 }).lean(),
    ]);

    // Backlog is a "right now" number, not range-scoped.
    const backlog = await Patient.countDocuments({ paymentStatus: "completed", status: "pending" });

    const inWindow = (d, a, b) => d && d >= a && d <= b;
    const paidDate = (p) => p.paymentDate || p.createdAt;

    const paid = patients.filter((p) => p.paymentStatus === "completed");
    const curPaid = paid.filter((p) => inWindow(paidDate(p), from, to));
    const prevPaid = paid.filter((p) => inWindow(paidDate(p), prevFrom, prevTo));

    const curUnpaid = patients.filter((p) => p.paymentStatus !== "completed" && inWindow(p.createdAt, from, to));

    const curReports = reports.filter((r) => inWindow(r.createdAt, from, to));
    const prevReports = reports.filter((r) => inWindow(r.createdAt, prevFrom, prevTo));

    const patientById = new Map(patients.map((p) => [String(p._id), p]));

    // Turnaround: hours from payment to report.
    const turnaroundHours = (rs) =>
      rs
        .map((r) => {
          const p = patientById.get(String(r.patient));
          if (!p) return null;
          return (r.createdAt.getTime() - paidDate(p).getTime()) / 3600000;
        })
        .filter((h) => h != null && h >= 0);

    const curTurnaround = turnaroundHours(curReports);
    const prevTurnaround = turnaroundHours(prevReports);

    const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
    const revenue = (arr) => sum(arr, (p) => p.amountPaid);

    // ---- Time series ------------------------------------------------------
    const keys = buildBuckets(from, to, bucket);
    const seriesMap = new Map(keys.map((k) => [k, { date: k, submissions: 0, completed: 0, revenue: 0 }]));
    for (const p of curPaid) {
      const row = seriesMap.get(bucketKeyFor(paidDate(p), bucket));
      if (row) {
        row.submissions += 1;
        row.revenue += p.amountPaid || 0;
      }
    }
    for (const r of curReports) {
      const row = seriesMap.get(bucketKeyFor(r.createdAt, bucket));
      if (row) row.completed += 1;
    }

    // ---- Breakdowns -------------------------------------------------------
    const genderMap = countBy(curPaid, (p) => p.gender || "unknown");
    const genderOrder = ["male", "female", "other", "unknown"];
    const gender = genderOrder.filter((g) => genderMap.has(g)).map((g) => ({ key: g, count: genderMap.get(g) }));

    const bandOrder = ["0–17", "18–29", "30–44", "45–59", "60+", "Unknown"];
    const bandMap = countBy(curPaid, (p) => ageBand(p.age));
    const ageBands = bandOrder.filter((b) => bandMap.has(b)).map((b) => ({ key: b, count: bandMap.get(b) }));

    // Sites are stored comma-separated ("Chest, Back Head"); count each site once per patient.
    const siteMap = new Map();
    for (const p of curPaid) {
      const sites = new Set(
        String(p.siteOfInfection || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
      for (const s of sites) siteMap.set(s, (siteMap.get(s) || 0) + 1);
    }
    const siteEntries = sortedEntries(siteMap);
    const sites = siteEntries.slice(0, 8);
    const otherSites = siteEntries.slice(8).reduce((a, x) => a + x.count, 0);
    if (otherSites) sites.push({ key: "Other", count: otherSites });

    const turnaroundBuckets = TURNAROUND_BUCKETS.map((b, i) => ({
      key: b.key,
      count: curTurnaround.filter((h) => h < b.max && (i === 0 || h >= TURNAROUND_BUCKETS[i - 1].max)).length,
    }));

    // Per-doctor leaderboard for the window.
    const byDoctor = new Map();
    for (const p of curPaid) {
      const id = String(p.doctor?._id || p.doctor || "unknown");
      if (!byDoctor.has(id)) byDoctor.set(id, { id, name: doctorName(p.doctor), submissions: 0, completed: 0, revenue: 0 });
      const row = byDoctor.get(id);
      row.submissions += 1;
      row.revenue += p.amountPaid || 0;
      if (p.status === "done") row.completed += 1;
    }
    const doctorRows = [...byDoctor.values()].sort((a, b) => b.submissions - a.submissions).slice(0, 10);

    const referralMap = countBy(doctors, (d) => d.howDoYouKnowAdmin || "Unknown");
    const referral = sortedEntries(referralMap);

    const activeDoctors = byDoctor.size;
    const newDoctorsInRange = doctors.filter((d) => {
      // Doctor has no createdAt; derive from ObjectId timestamp.
      const ts = d._id.getTimestamp();
      return inWindow(ts, from, to);
    }).length;

    // ---- Recent submissions -----------------------------------------------
    const recent = [...curPaid]
      .sort((a, b) => paidDate(b) - paidDate(a))
      .slice(0, 8)
      .map((p) => ({
        id: String(p._id),
        patient: `${p.firstname || ""} ${p.lastname || ""}`.trim() || "Unknown",
        doctor: doctorName(p.doctor),
        date: paidDate(p),
        status: p.status === "done" ? "Completed" : "Pending",
        amount: p.amountPaid || 0,
      }));

    res.status(200).json({
      success: true,
      range: { key: rangeKey, from, to, bucket },
      kpis: {
        submissions: { value: curPaid.length, previous: prevPaid.length },
        completed: { value: curReports.length, previous: prevReports.length },
        backlog: { value: backlog },
        revenue: { value: revenue(curPaid), previous: revenue(prevPaid) },
        turnaround: {
          medianHours: median(curTurnaround),
          avgHours: mean(curTurnaround),
          previousMedianHours: median(prevTurnaround),
          samples: curTurnaround.length,
        },
        doctors: { active: activeDoctors, total: doctors.length, newInRange: newDoctorsInRange },
        unpaid: { value: curUnpaid.length },
      },
      series: [...seriesMap.values()],
      breakdowns: { gender, ageBands, sites, turnaroundBuckets, doctors: doctorRows, referral },
      recent,
    });
  } catch (error) {
    console.error("Error computing analytics:", error);
    res.status(500).json({ success: false, message: "Error computing analytics.", error: error.message });
  }
};
