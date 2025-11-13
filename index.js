import dotenv from "dotenv";
dotenv.config();

import express from "express";
import helmet from "helmet";
import cors from "cors";
import { MongoClient } from "mongodb";


const app = express();
const PORT = process.env.PORT || 8000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://share_a_bite_main_db:pAss123@cluster0.xdnshxt.mongodb.net/?appName=Cluster0";

let cachedClient = null;
let cachedDb = null;

async function connectDb() {
    if (cachedDb) return cachedDb;
    const client = new MongoClient(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    cachedClient = client;
    cachedDb = client.db("donate");
    console.log("Connected to MongoDB:", "donate");
    return cachedDb;
}

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "6mb" }));

function getUserFromHeader(req) {
    const email = (req.headers["x-user-email"] || "").toString().trim();
    if (!email) return null;
    return {
        email,
        name: (req.headers["x-user-name"] || email).toString(),
        picture: (req.headers["x-user-picture"] || null)?.toString() || null,
    };
}

function parseQuantityNumber(quantityText) {
    if (!quantityText) return 0;
    const m = quantityText.match(/\d+/);
    return m ? Number(m[0]) : 0;
}

app.get("/", (req, res) => res.send({ ok: true, service: "Share A Bite API (no-firebase-auth mode)" }));

app.get("/api/foods", async (req, res) => {
    try {
        const db = await connectDb();
        const q = {};
        if (req.query.status) q.status = req.query.status;
        if (req.query.donatorEmail) q["donator.email"] = req.query.donatorEmail;
        const foods = await db.collection("foods").find(q).sort({ quantityNumber: -1, createdAt: -1 }).toArray();
        res.json(foods);
    } catch (err) {
        console.error("GET /api/foods error:", err);
        res.status(500).json({ error: "Failed to fetch foods" });
    }
});

app.get("/api/foods/:id", async (req, res) => {
    try {
        const db = await connectDb();
        const id = req.params.id;
        const f = await db.collection("foods").findOne({ _id: id });
        if (!f) return res.status(404).json({ error: "Food not found" });
        res.json(f);
    } catch (err) {
        console.error("GET /api/foods/:id error:", err);
        res.status(500).json({ error: "Failed to fetch food" });
    }
});

app.post("/api/foods", async (req, res) => {
    try {
        const db = await connectDb();
        const payload = req.body || {};
        if (!payload.name) return res.status(400).json({ error: "Missing food name" });

        const headerUser = getUserFromHeader(req);
        const donatorFromBody = payload.donator || {};
        const donator = {
            uid: donatorFromBody.uid || null,
            name: headerUser?.name || donatorFromBody.name || "",
            email: headerUser?.email || donatorFromBody.email || "",
            photo: headerUser?.picture || donatorFromBody.photo || null,
        };

        let quantityNumber = 0;
        if (typeof payload.quantityNumber === "number") quantityNumber = payload.quantityNumber;
        else if (payload.quantityText) quantityNumber = parseQuantityNumber(payload.quantityText);

        const doc = {
            _id: "food-" + Date.now(),
            name: payload.name,
            image: payload.image || null,
            quantityText: payload.quantityText || "",
            quantityNumber,
            pickupLocation: payload.pickupLocation || "",
            expireDate: payload.expireDate || null,
            notes: payload.notes || "",
            donator,
            status: payload.status || "Available",
            createdAt: new Date().toISOString(),
        };

        await db.collection("foods").insertOne(doc);
        res.status(201).json({ success: true, food: doc });
    } catch (err) {
        console.error("POST /api/foods error:", err);
        res.status(500).json({ error: "Failed to create food" });
    }
});

app.patch("/api/foods/:id", async (req, res) => {
    try {
        const db = await connectDb();
        const id = req.params.id;
        const existing = await db.collection("foods").findOne({ _id: id });
        if (!existing) return res.status(404).json({ error: "Food not found" });

        const user = getUserFromHeader(req) || { email: req.body.userEmail || "" };
        if (!user || !user.email) {
            return res.status(403).json({ error: "Not allowed — missing user identity (x-user-email header or body.userEmail required)" });
        }
        if (existing.donator?.email !== user.email) return res.status(403).json({ error: "Not allowed" });

        const updates = req.body || {};
        if (updates.quantityText && !updates.quantityNumber) updates.quantityNumber = parseQuantityNumber(updates.quantityText);
        updates.updatedAt = new Date().toISOString();

        await db.collection("foods").updateOne({ _id: id }, { $set: updates });
        const updated = await db.collection("foods").findOne({ _id: id });
        res.json({ success: true, food: updated });
    } catch (err) {
        console.error("PATCH /api/foods/:id error:", err);
        res.status(500).json({ error: "Failed to update food" });
    }
});

app.delete("/api/foods/:id", async (req, res) => {
    try {
        const db = await connectDb();
        const id = req.params.id;
        const existing = await db.collection("foods").findOne({ _id: id });
        if (!existing) return res.status(404).json({ error: "Food not found" });

        const user = getUserFromHeader(req) || { email: req.body.userEmail || "" };
        if (!user || !user.email) {
            return res.status(403).json({ error: "Not allowed — missing user identity (x-user-email header or body.userEmail required)" });
        }
        if (existing.donator?.email !== user.email) return res.status(403).json({ error: "Not allowed" });

        await db.collection("foods").deleteOne({ _id: id });
        await db.collection("requests").deleteMany({ foodId: id });
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE /api/foods/:id error:", err);
        res.status(500).json({ error: "Failed to delete food" });
    }
});

app.get("/api/foods/my/list/me", async (req, res) => {
    try {
        const db = await connectDb();
        const user = getUserFromHeader(req) || { email: req.query.email || "" };
        if (!user || !user.email) return res.status(400).json({ error: "Missing user identity (x-user-email header or ?email=... required)" });
        const foods = await db.collection("foods").find({ "donator.email": user.email }).sort({ createdAt: -1 }).toArray();
        res.json(foods);
    } catch (err) {
        console.error("GET /api/foods/my/list/me error:", err);
        res.status(500).json({ error: "Failed to fetch my foods" });
    }
});

app.post("/api/foods/:foodId/requests", async (req, res) => {
    try {
        const db = await connectDb();
        const foodId = req.params.foodId;
        const { location, reason, contact } = req.body || {};
        if (!location || !reason || !contact) return res.status(400).json({ error: "Missing fields" });

        const food = await db.collection("foods").findOne({ _id: foodId });
        if (!food) return res.status(404).json({ error: "Food not found" });
        if (food.status && food.status.toLowerCase() !== "available") return res.status(400).json({ error: "Food not available" });

        const headerUser = getUserFromHeader(req);
        const requesterFromBody = req.body.requester || {};
        const requester = {
            uid: requesterFromBody.uid || null,
            name: headerUser?.name || requesterFromBody.name || req.body.name || "Anonymous",
            email: headerUser?.email || requesterFromBody.email || req.body.email || "",
            photoURL: headerUser?.picture || requesterFromBody.photoURL || null,
        };

        const reqDoc = {
            _id: "req-" + Date.now(),
            foodId,
            requester,
            location,
            reason,
            contact,
            status: "pending",
            createdAt: new Date().toISOString(),
        };

        await db.collection("requests").insertOne(reqDoc);
        res.status(201).json({ success: true, request: reqDoc });
    } catch (err) {
        console.error("POST /api/foods/:foodId/requests error:", err);
        res.status(500).json({ error: "Failed to create request" });
    }
});

app.get("/api/foods/:foodId/requests", async (req, res) => {
    try {
        const db = await connectDb();
        const foodId = req.params.foodId;
        const food = await db.collection("foods").findOne({ _id: foodId });
        if (!food) return res.status(404).json({ error: "Food not found" });

        const user = getUserFromHeader(req) || { email: req.query.email || "" };
        if (!user || !user.email) return res.status(403).json({ error: "Not allowed — missing user identity (x-user-email header or ?email required)" });
        if (food.donator?.email !== user.email) return res.status(403).json({ error: "Not allowed" });

        const reqs = await db.collection("requests").find({ foodId }).sort({ createdAt: -1 }).toArray();
        res.json(reqs);
    } catch (err) {
        console.error("GET /api/foods/:foodId/requests error:", err);
        res.status(500).json({ error: "Failed to fetch requests" });
    }
});

app.patch("/api/requests/:requestId", async (req, res) => {
    try {
        const db = await connectDb();
        const requestId = req.params.requestId;
        const { status } = req.body;
        if (!["accepted", "rejected", "pending"].includes(status)) return res.status(400).json({ error: "Invalid status" });

        const reqDoc = await db.collection("requests").findOne({ _id: requestId });
        if (!reqDoc) return res.status(404).json({ error: "Request not found" });

        const food = await db.collection("foods").findOne({ _id: reqDoc.foodId });
        if (!food) return res.status(404).json({ error: "Food not found" });

        const user = getUserFromHeader(req) || { email: req.body.userEmail || "" };
        if (!user || !user.email) return res.status(403).json({ error: "Not allowed — missing user identity (x-user-email header or body.userEmail required)" });
        if (food.donator?.email !== user.email) return res.status(403).json({ error: "Not allowed" });

        await db.collection("requests").updateOne({ _id: requestId }, { $set: { status, updatedAt: new Date().toISOString() } });

        if (status === "accepted") {
            await db.collection("foods").updateOne({ _id: food._id }, { $set: { status: "Donated", updatedAt: new Date().toISOString() } });
        }

        const updated = await db.collection("requests").findOne({ _id: requestId });
        res.json({ success: true, request: updated });
    } catch (err) {
        console.error("PATCH /api/requests/:requestId error:", err);
        res.status(500).json({ error: "Failed to update request" });
    }
});

app.get("/api/my/requests", async (req, res) => {
    try {
        const db = await connectDb();
        const user = getUserFromHeader(req) || { email: req.query.email || "" };
        if (!user || !user.email) return res.status(400).json({ error: "Missing user identity (x-user-email header or ?email required)" });
        const reqs = await db.collection("requests").find({ "requester.email": user.email }).sort({ createdAt: -1 }).toArray();
        res.json(reqs);
    } catch (err) {
        console.error("GET /api/my/requests error:", err);
        res.status(500).json({ error: "Failed to fetch my requests" });
    }
});



app.all("*", (req, res) => res.status(404).json({ error: "Route not found" }));

(async () => {
    try {
        await connectDb();
        app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
    } catch (err) {
        console.error("Startup error:", err);
        process.exit(1);
    }
})();

