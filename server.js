const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "legal_system",
};

let pool;

async function initDB() {
  pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  await pool.query("CREATE TABLE IF NOT EXISTS notifications (id INT AUTO_INCREMENT PRIMARY KEY, client_id INT NULL, message TEXT NOT NULL, date VARCHAR(100) DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  await pool.query("CREATE TABLE IF NOT EXISTS clients (id INT AUTO_INCREMENT PRIMARY KEY, full_name VARCHAR(150) NOT NULL, phone VARCHAR(50) DEFAULT '', email VARCHAR(150) DEFAULT '', national_id VARCHAR(50) DEFAULT '', address VARCHAR(255) DEFAULT '', notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  await pool.query("CREATE TABLE IF NOT EXISTS lawyers (id INT AUTO_INCREMENT PRIMARY KEY, full_name VARCHAR(150) NOT NULL, specialization VARCHAR(120) DEFAULT 'General', phone VARCHAR(50) DEFAULT '', email VARCHAR(150) DEFAULT '', status VARCHAR(50) DEFAULT 'Available', notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  await pool.query("CREATE TABLE IF NOT EXISTS cases (id INT AUTO_INCREMENT PRIMARY KEY, case_number VARCHAR(100) NOT NULL, title VARCHAR(200) NOT NULL, case_type VARCHAR(100) DEFAULT 'Civil', status VARCHAR(60) DEFAULT 'Open', client_id INT NULL, lawyer_id INT NULL, defendant_name VARCHAR(150) DEFAULT '', defendant_details TEXT, court_name VARCHAR(150) DEFAULT '', next_hearing_date VARCHAR(50) DEFAULT '', summary TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  await pool.query("CREATE TABLE IF NOT EXISTS appointments (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(200) NOT NULL, appointment_type VARCHAR(60) DEFAULT 'In-Person', appointment_date VARCHAR(50) NOT NULL, appointment_time VARCHAR(50) DEFAULT '', client_id INT NULL, lawyer_id INT NULL, case_id INT NULL, status VARCHAR(60) DEFAULT 'Scheduled', notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  await pool.query("CREATE TABLE IF NOT EXISTS invoices (id INT AUTO_INCREMENT PRIMARY KEY, invoice_number VARCHAR(100) NOT NULL, client_id INT NULL, case_id INT NULL, amount DECIMAL(10,2) DEFAULT 0.00, status VARCHAR(60) DEFAULT 'Unpaid', issue_date VARCHAR(50) DEFAULT '', notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: dbConfig.database });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ================= Notifications =================
app.get("/api/notifications", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM notifications ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    console.error("GET /api/notifications error:", err);
    res.status(500).json({ error: err.message || "Failed to load notifications" });
  }
});

app.post("/api/notifications", async (req, res) => {
  try {
    const body = req.body || {};
    const messageText = String(body.message ?? body.title ?? "").trim();
    const dateValue =
      String(body.date ?? "").trim() || new Date().toISOString().slice(0, 10);

    if (!messageText) {
      return res.status(400).json({ error: "Notification message is required" });
    }

    const [result] = await pool.query(
      "INSERT INTO notifications (message, date) VALUES (?, ?)",
      [messageText, dateValue]
    );

    const [rows] = await pool.query("SELECT * FROM notifications WHERE id = ?", [
      result.insertId,
    ]);
    res
      .status(201)
      .json(rows[0] || { id: result.insertId, message: messageText, date: dateValue });
  } catch (err) {
    console.error("POST /api/notifications error:", err);
    res.status(500).json({ error: err.message || "Failed to save notification" });
  }
});
 app.put("/api/notifications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { message, client_id, date } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Message is required" });
    }
    const [existing] = await pool.query("SELECT * FROM notifications WHERE id = ?", [id]);
    if (!existing.length) {
      return res.status(404).json({ error: "Notification not found" });
    }
    const updatedClientId = client_id !== undefined && client_id !== "" ? Number(client_id) : existing[0].client_id;
    const updatedDate = date !== undefined && date !== "" ? date : existing[0].date;
    await pool.query("UPDATE notifications SET message = ?, client_id = ?, date = ? WHERE id = ?", [String(message).trim(), updatedClientId, updatedDate, id]);
    res.json({ id: Number(id), message: String(message).trim(), client_id: updatedClientId, date: updatedDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/notifications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM notifications WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }
    res.json({ deleted: true, id: Number(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= QR & Invoice View =================
app.get("/api/qr/generate/:invoiceId", async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const viewUrl = `http://localhost:3000/api/qr/view/${encodeURIComponent(invoiceId)}`;
    const qrDataUrl = await QRCode.toDataURL(viewUrl);
    res.json({ invoiceId, viewUrl, qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/qr/view/:invoiceId", async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const [rows] = await pool.query("SELECT * FROM invoices WHERE id = ? OR invoice_number = ? LIMIT 1", [Number(invoiceId) || 0, invoiceId]);
    const inv = rows[0];
    res.json({
      invoiceId,
      found: Boolean(inv),
      invoice: inv || { invoice_number: invoiceId, status: "Recorded", notes: "Invoice #" + invoiceId },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= Clients =================
app.get("/api/clients", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM clients ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/clients", async (req, res) => {
  try {
    const body = req.body || {};
    const clientName = body.name ?? body.full_name ?? "";
    const clientEmail = body.email ?? "";
    const clientPhone = body.phone ?? "";

    if (!String(clientName).trim()) {
      return res.status(400).json({ error: "Client name is required" });
    }

    const [result] = await pool.query(
      "INSERT INTO clients (name, email, phone) VALUES (?, ?, ?)",
      [
        String(clientName).trim(),
        String(clientEmail).trim(),
        String(clientPhone).trim(),
      ]
    );

    const [rows] = await pool.query("SELECT * FROM clients WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0] || { id: result.insertId, name: String(clientName).trim() });
  } catch (err) {
    console.error("POST /api/clients error:", err);
    res.status(500).json({ error: err.message || "Failed to save client" });
  }
});

app.put("/api/clients/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, phone, email, national_id, address, notes } = req.body;
    const [existing] = await pool.query("SELECT * FROM clients WHERE id = ?", [id]);
    if (!existing.length) return res.status(404).json({ error: "Client not found" });
    const updated = {
      full_name: full_name !== undefined && String(full_name).trim() ? String(full_name).trim() : existing[0].full_name,
 phone: phone !== undefined ? phone : existing[0].phone,
      email: email !== undefined ? email : existing[0].email,
      national_id: national_id !== undefined ? national_id : existing[0].national_id,
      address: address !== undefined ? address : existing[0].address,
      notes: notes !== undefined ? notes : existing[0].notes,
    };
    await pool.query("UPDATE clients SET full_name=?, phone=?, email=?, national_id=?, address=?, notes=? WHERE id=?", [updated.full_name, updated.phone, updated.email, updated.national_id, updated.address, updated.notes, id]);
    res.json({ id: Number(id), ...updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/clients/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM clients WHERE id = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Client not found" });
    res.json({ deleted: true, id: Number(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= Lawyers =================
app.get("/api/lawyers", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM lawyers ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/lawyers", async (req, res) => {
  try {
    const { full_name, specialization = "General", phone = "", email = "", status = "Available", notes = "" } = req.body;
    if (!full_name || !String(full_name).trim()) {
      return res.status(400).json({ error: "Lawyer name is required" });
    }
    const [result] = await pool.query("INSERT INTO lawyers (full_name, specialization, phone, email, status, notes) VALUES (?, ?, ?, ?, ?, ?)", [String(full_name).trim(), specialization, phone, email, status, notes]);
    res.status(201).json({ id: result.insertId, full_name: String(full_name).trim(), specialization, phone, email, status, notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/lawyers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, specialization, phone, email, status, notes } = req.body;
    const [existing] = await pool.query("SELECT * FROM lawyers WHERE id = ?", [id]);
    if (!existing.length) return res.status(404).json({ error: "Lawyer not found" });
    const updated = {
      full_name: full_name !== undefined && String(full_name).trim() ? String(full_name).trim() : existing[0].full_name,
      specialization: specialization !== undefined ? specialization : existing[0].specialization,
      phone: phone !== undefined ? phone : existing[0].phone,
      email: email !== undefined ? email : existing[0].email,
      status: status !== undefined ? status : existing[0].status,
      notes: notes !== undefined ? notes : existing[0].notes,
    };
    await pool.query("UPDATE lawyers SET full_name=?, specialization=?, phone=?, email=?, status=?, notes=? WHERE id=?", [updated.full_name, updated.specialization, updated.phone, updated.email, updated.status, updated.notes, id]);
    res.json({ id: Number(id), ...updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/lawyers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM lawyers WHERE id = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Lawyer not found" });
    res.json({ deleted: true, id: Number(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= Cases =================
app.get("/api/cases", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT c.*, cl.full_name AS client_name, lw.full_name AS lawyer_name FROM cases c LEFT JOIN clients cl ON c.client_id = cl.id LEFT JOIN lawyers lw ON c.lawyer_id = lw.id ORDER BY c.id DESC");
 res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/cases", async (req, res) => {
  try {
    const { case_number, title, case_type = "Civil", status = "Open", client_id = null, lawyer_id = null, defendant_name = "", defendant_details = "", court_name = "", next_hearing_date = "", summary = "" } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "Case title is required" });
    }
    const finalCaseNumber = case_number && String(case_number).trim() ? String(case_number).trim() : "CASE-" + Date.now().toString().slice(-6);
    const [result] = await pool.query("INSERT INTO cases (case_number, title, case_type, status, client_id, lawyer_id, defendant_name, defendant_details, court_name, next_hearing_date, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [finalCaseNumber, String(title).trim(), case_type, status, client_id ? Number(client_id) : null, lawyer_id ? Number(lawyer_id) : null, defendant_name, defendant_details, court_name, next_hearing_date, summary]);
    res.status(201).json({ id: result.insertId, case_number: finalCaseNumber, title: String(title).trim(), case_type, status, client_id: client_id ? Number(client_id) : null, lawyer_id: lawyer_id ? Number(lawyer_id) : null, defendant_name, defendant_details, court_name, next_hearing_date, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/cases/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [existingRows] = await pool.query("SELECT * FROM cases WHERE id = ?", [id]);
    if (!existingRows.length) return res.status(404).json({ error: "Case not found" });
    const existing = existingRows[0];
    const body = req.body;
    const updated = {
      case_number: body.case_number !== undefined && String(body.case_number).trim() ? String(body.case_number).trim() : existing.case_number,
      title: body.title !== undefined && String(body.title).trim() ? String(body.title).trim() : existing.title,
      case_type: body.case_type !== undefined ? body.case_type : existing.case_type,
      status: body.status !== undefined ? body.status : existing.status,
      client_id: body.client_id !== undefined ? (body.client_id ? Number(body.client_id) : null) : existing.client_id,
      lawyer_id: body.lawyer_id !== undefined ? (body.lawyer_id ? Number(body.lawyer_id) : null) : existing.lawyer_id,
      defendant_name: body.defendant_name !== undefined ? body.defendant_name : existing.defendant_name,
      defendant_details: body.defendant_details !== undefined ? body.defendant_details : existing.defendant_details,
      court_name: body.court_name !== undefined ? body.court_name : existing.court_name,
      next_hearing_date: body.next_hearing_date !== undefined ? body.next_hearing_date : existing.next_hearing_date,
      summary: body.summary !== undefined ? body.summary : existing.summary,
    };
    await pool.query("UPDATE cases SET case_number=?, title=?, case_type=?, status=?, client_id=?, lawyer_id=?, defendant_name=?, defendant_details=?, court_name=?, next_hearing_date=?, summary=? WHERE id=?", [updated.case_number, updated.title, updated.case_type, updated.status, updated.client_id, updated.lawyer_id, updated.defendant_name, updated.defendant_details, updated.court_name, updated.next_hearing_date, updated.summary, id]);
    res.json({ id: Number(id), ...updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/cases/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM cases WHERE id = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Case not found" });
    res.json({ deleted: true, id: Number(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 // ================= Appointments =================
app.get("/api/appointments", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM appointments ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    console.error("GET /api/appointments error:", err);
    res.status(500).json({ error: err.message || "Failed to load appointments" });
  }
});

app.post("/api/appointments", async (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title ?? "").trim();
    if (!title) {
      return res.status(400).json({ error: "Appointment title is required" });
    }

    const appointment_type = String(body.appointment_type ?? "حضوري").trim() || "حضوري";
    const appointment_date = String(body.appointment_date ?? "").trim();
    const appointment_time = String(body.appointment_time ?? "").trim();
    const client_id = body.client_id ? Number(body.client_id) : null;
    const lawyer_id = body.lawyer_id ? Number(body.lawyer_id) : null;
    const case_id = body.case_id ? Number(body.case_id) : null;
    const status = String(body.status ?? "مجدول").trim() || "مجدول";
    const notes = String(body.notes ?? "").trim();

    const [result] = await pool.query(
      "INSERT INTO appointments (title, appointment_type, appointment_date, appointment_time, client_id, lawyer_id, case_id, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [title, appointment_type, appointment_date, appointment_time, client_id, lawyer_id, case_id, status, notes]
    );

    const [rows] = await pool.query("SELECT * FROM appointments WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0] || { id: result.insertId, title });
  } catch (err) {
    console.error("POST /api/appointments error:", err);
    res.status(500).json({ error: err.message || "Failed to save appointment" });
  }
});

app.put("/api/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [existingRows] = await pool.query("SELECT * FROM appointments WHERE id = ?", [id]);
    if (!existingRows.length) return res.status(404).json({ error: "Appointment not found" });
    const existing = existingRows[0];
    const body = req.body;
    const updated = {
      title: body.title !== undefined && String(body.title).trim() ? String(body.title).trim() : existing.title,
      appointment_type: body.appointment_type !== undefined ? body.appointment_type : existing.appointment_type,
      appointment_date: body.appointment_date !== undefined ? body.appointment_date : existing.appointment_date,
      appointment_time: body.appointment_time !== undefined ? body.appointment_time : existing.appointment_time,
      client_id: body.client_id !== undefined ? (body.client_id ? Number(body.client_id) : null) : existing.client_id,
      lawyer_id: body.lawyer_id !== undefined ? (body.lawyer_id ? Number(body.lawyer_id) : null) : existing.lawyer_id,
      case_id: body.case_id !== undefined ? (body.case_id ? Number(body.case_id) : null) : existing.case_id,
      status: body.status !== undefined ? body.status : existing.status,
      notes: body.notes !== undefined ? body.notes : existing.notes,
    };
    await pool.query("UPDATE appointments SET title=?, appointment_type=?, appointment_date=?, appointment_time=?, client_id=?, lawyer_id=?, case_id=?, status=?, notes=? WHERE id=?", [updated.title, updated.appointment_type, updated.appointment_date, updated.appointment_time, updated.client_id, updated.lawyer_id, updated.case_id, updated.status, updated.notes, id]);
    res.json({ id: Number(id), ...updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM appointments WHERE id = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Appointment not found" });
    res.json({ deleted: true, id: Number(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 // ================= Invoices =================
app.get("/api/invoices", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM invoices ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    console.error("GET /api/invoices error:", err);
    res.status(500).json({ error: err.message || "Failed to load invoices" });
  }
});

app.post("/api/invoices", async (req, res) => {
  try {
    const body = req.body || {};
    const client_name = String(
      body.client_name ?? body.invoice_number ?? body.client_id ?? ""
    ).trim();
    const amount = body.amount !== undefined && body.amount !== "" ? Number(body.amount) : 0;
    const rawDate = String(body.date ?? body.issue_date ?? "").trim();
    const date = rawDate ? rawDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const status = String(body.status ?? "Unpaid").trim() || "Unpaid";

    const [result] = await pool.query(
      "INSERT INTO invoices (client_name, amount, date, status) VALUES (?, ?, ?, ?)",
      [client_name, Number.isNaN(amount) ? 0 : amount, date, status]
    );

    const [rows] = await pool.query("SELECT * FROM invoices WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0] || { id: result.insertId, client_name, amount, date, status });
  } catch (err) {
    console.error("POST /api/invoices error:", err);
    res.status(500).json({ error: err.message || "Failed to save invoice" });
  }
});

app.put("/api/invoices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [existingRows] = await pool.query("SELECT * FROM invoices WHERE id = ?", [id]);
    if (!existingRows.length) return res.status(404).json({ error: "Invoice not found" });
    const existing = existingRows[0];
    const body = req.body;
    const updated = {
      invoice_number: body.invoice_number !== undefined && String(body.invoice_number).trim() ? String(body.invoice_number).trim() : existing.invoice_number,
      client_id: body.client_id !== undefined ? (body.client_id ? Number(body.client_id) : null) : existing.client_id,
      case_id: body.case_id !== undefined ? (body.case_id ? Number(body.case_id) : null) : existing.case_id,
      amount: body.amount !== undefined ? Number(body.amount) || 0 : existing.amount,
      status: body.status !== undefined ? body.status : existing.status,
      issue_date: body.issue_date !== undefined ? body.issue_date : existing.issue_date,
      notes: body.notes !== undefined ? body.notes : existing.notes,
    };
    await pool.query("UPDATE invoices SET invoice_number=?, client_id=?, case_id=?, amount=?, status=?, issue_date=?, notes=? WHERE id=?", [updated.invoice_number, updated.client_id, updated.case_id, updated.amount, updated.status, updated.issue_date, updated.notes, id]);
    res.json({ id: Number(id), ...updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/invoices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM invoices WHERE id = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Invoice not found" });
    res.json({ deleted: true, id: Number(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
  });