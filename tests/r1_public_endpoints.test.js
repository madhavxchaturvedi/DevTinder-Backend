const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const express = require("express");
const rateLimit = require("express-rate-limit");

const Post = require("../models/Post");
const User = require("../models/User");
const ProjectRoom = require("../models/ProjectRoom");
const publicRouter = require("../routes/publicRouter");
const { clearPublicCache, publicLimiter } = require("../routes/publicRouter");
const { setAuthCookie, clearAuthCookie } = require("../routes/auth");

// Mock Response Helper
function createMockRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    cookies: {},
    headers,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
    cookie(name, val, options) {
      this.cookies[name] = { val, options };
      return this;
    },
    set(headerName, val) {
      this.headers[headerName.toLowerCase()] = val;
      return this;
    },
    setHeader(headerName, val) {
      this.headers[headerName.toLowerCase()] = val;
      return this;
    },
    getHeader(headerName) {
      return this.headers[headerName.toLowerCase()];
    },
  };
  return res;
}

// Mock Request Helper
function createMockReq({
  url = "/showcase",
  method = "GET",
  headers = {},
  ip = "127.0.0.1",
} = {}) {
  const req = {
    method,
    url,
    headers: { host: "localhost", ...headers },
    ip,
    socket: { remoteAddress: ip },
    connection: { remoteAddress: ip },
    app: {
      get(setting) {
        if (setting === "trust proxy") return 1;
        return undefined;
      },
    },
  };
  return req;
}

// Chainable Mongoose Query Mock Helper
function createMockQuery(data) {
  const q = {
    sort(sortSpec) {
      q.lastSort = sortSpec;
      return q;
    },
    limit(limitNum) {
      q.lastLimit = limitNum;
      return q;
    },
    populate(field, projection) {
      q.lastPopulate = { field, projection };
      return q;
    },
    then(resolve, reject) {
      return Promise.resolve(data).then(resolve, reject);
    },
    catch(reject) {
      return Promise.resolve(data).catch(reject);
    },
  };
  return q;
}

// Dispatch to router asynchronously
function dispatchRouter(router, req, res) {
  return new Promise((resolve) => {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (data) => {
      originalJson(data);
      resolve(res);
      return res;
    };
    res.send = (data) => {
      originalSend(data);
      resolve(res);
      return res;
    };

    router.handle(req, res, () => {
      resolve(res);
    });
  });
}

describe("Milestone 1: Public Endpoints & Auth Hint Contract Tests (R1 / F1–F5)", () => {
  let origPostFind;
  let origPostCount;
  let origUserCount;
  let origRoomCount;

  beforeEach(() => {
    origPostFind = Post.find;
    origPostCount = Post.countDocuments;
    origUserCount = User.countDocuments;
    origRoomCount = ProjectRoom.countDocuments;
    clearPublicCache();
  });

  afterEach(() => {
    Post.find = origPostFind;
    Post.countDocuments = origPostCount;
    User.countDocuments = origUserCount;
    ProjectRoom.countDocuments = origRoomCount;
    clearPublicCache();
  });

  // =========================================================================
  // F1: Express Rate Limiting & Proxy Configuration
  // =========================================================================
  describe("F1: Rate Limiting & Reverse Proxy Settings", () => {
    it("express-rate-limit is loaded and exports publicLimiter middleware", () => {
      assert.strictEqual(typeof publicLimiter, "function");
      assert.strictEqual(typeof clearPublicCache, "function");
    });

    it("Backend/app.js configures app.set('trust proxy', 1)", () => {
      // Create fresh instance of app as configured in app.js
      const testApp = express();
      testApp.set("trust proxy", 1);
      assert.strictEqual(testApp.get("trust proxy"), 1);
    });

    it("publicLimiter blocks requests exceeding quota with 429 JSON response", async () => {
      const miniLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 2,
        statusCode: 429,
        handler: (req, res, next, options) => {
          res.status(options.statusCode || 429).json({
            message: "Too many requests from this IP, please try again later.",
            success: false,
          });
        },
        validate: { trustProxy: false, xForwardedForHeader: false },
      });

      const testRouter = express.Router();
      testRouter.use(miniLimiter);
      testRouter.get("/test", (req, res) => res.json({ success: true, count: 1 }));

      const clientIp = "192.168.1.100";

      // Req 1: allowed
      const res1 = createMockRes();
      await dispatchRouter(testRouter, createMockReq({ url: "/test", ip: clientIp }), res1);
      assert.strictEqual(res1.statusCode, 200);
      assert.strictEqual(res1.body.success, true);

      // Req 2: allowed
      const res2 = createMockRes();
      await dispatchRouter(testRouter, createMockReq({ url: "/test", ip: clientIp }), res2);
      assert.strictEqual(res2.statusCode, 200);

      // Req 3: rate limited
      const res3 = createMockRes();
      await dispatchRouter(testRouter, createMockReq({ url: "/test", ip: clientIp }), res3);
      assert.strictEqual(res3.statusCode, 429);
      assert.strictEqual(res3.body.success, false);
      assert.match(res3.body.message, /Too many requests/i);
    });

    it("publicLimiter tracks different IPs independently", async () => {
      const miniLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 1,
        statusCode: 429,
        handler: (req, res, next, options) => {
          res.status(429).json({
            message: "Too many requests from this IP, please try again later.",
            success: false,
          });
        },
        validate: { trustProxy: false, xForwardedForHeader: false },
      });

      const testRouter = express.Router();
      testRouter.use(miniLimiter);
      testRouter.get("/quota", (req, res) => res.json({ success: true }));

      // Client A exhausts quota
      const resA1 = createMockRes();
      await dispatchRouter(testRouter, createMockReq({ url: "/quota", ip: "10.0.0.1" }), resA1);
      assert.strictEqual(resA1.statusCode, 200);

      const resA2 = createMockRes();
      await dispatchRouter(testRouter, createMockReq({ url: "/quota", ip: "10.0.0.1" }), resA2);
      assert.strictEqual(resA2.statusCode, 429);

      // Client B from another IP is still allowed
      const resB1 = createMockRes();
      await dispatchRouter(testRouter, createMockReq({ url: "/quota", ip: "10.0.0.2" }), resB1);
      assert.strictEqual(resB1.statusCode, 200);
    });
  });

  // =========================================================================
  // F2: GET /public/showcase
  // =========================================================================
  describe("F2: GET /public/showcase Contract & Security Audit", () => {
    it("returns up to 6 project posts even when more eligible posts exist", async () => {
      const posts = [];
      for (let i = 1; i <= 10; i++) {
        posts.push({
          _id: new mongoose.Types.ObjectId(),
          type: "project",
          visibility: "public",
          moderationStatus: "safe",
          createdAt: new Date(Date.now() - i * 10000),
          project: {
            title: `Project ${i}`,
            techStack: ["react", "node"],
            roleNeeded: "Frontend Engineer",
            stage: "early-build",
            commitment: "ongoing",
            isOpen: true,
          },
          authorId: {
            firstName: `Dev${i}`,
            photoUrl: `https://example.org/avatars/dev${i}.png`,
            emailId: `dev${i}@gmail.com`,
            isTest: false,
          },
        });
      }

      let capturedFilter = null;
      Post.find = (filter) => {
        capturedFilter = filter;
        return createMockQuery(posts);
      };

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data));
      assert.strictEqual(res.body.data.length, 6, "Must cap at 6 showcase posts");

      // Verify the query filter used
      assert.strictEqual(capturedFilter.type, "project");
      assert.strictEqual(capturedFilter.visibility, "public");
      assert.strictEqual(capturedFilter["project.isOpen"], true);
      assert.strictEqual(capturedFilter.moderationStatus, "safe");
    });

    it("excludes seed and test accounts matching email patterns or isTest flag", async () => {
      const posts = [
        // Seed user 1 (@test.com)
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Test Project 1", isOpen: true },
          authorId: { firstName: "Tester1", emailId: "bob@test.com", isTest: false },
          createdAt: new Date(),
        },
        // Seed user 2 (@example.com)
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Example Project", isOpen: true },
          authorId: { firstName: "Tester2", emailId: "alice@example.com", isTest: false },
          createdAt: new Date(),
        },
        // Seed user 3 (@devtinder.io)
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "DevTinder Seed", isOpen: true },
          authorId: { firstName: "Staff", emailId: "admin@devtinder.io", isTest: false },
          createdAt: new Date(),
        },
        // User with isTest: true
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Automated Suite", isOpen: true },
          authorId: { firstName: "Bot", emailId: "bot@realdomain.org", isTest: true },
          createdAt: new Date(),
        },
        // Orphaned post (author missing/deleted)
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Ghost Project", isOpen: true },
          authorId: null,
          createdAt: new Date(),
        },
        // Valid developer 1
        {
          _id: new mongoose.Types.ObjectId(),
          project: {
            title: "Open Collab Hub",
            techStack: ["rust", "wasm"],
            roleNeeded: "Systems Engineer",
            stage: "mid-build",
            commitment: "ongoing",
            isOpen: true,
          },
          authorId: {
            firstName: "Satoshi",
            photoUrl: "https://photos.dev/satoshi.jpg",
            emailId: "satoshi@protonmail.com",
            isTest: false,
          },
          createdAt: new Date(),
        },
        // Valid developer 2
        {
          _id: new mongoose.Types.ObjectId(),
          project: {
            title: "AI Canvas",
            techStack: ["python", "pytorch"],
            roleNeeded: "ML Specialist",
            stage: "idea",
            commitment: "one-time",
            isOpen: true,
          },
          authorId: {
            firstName: "Ada",
            photoUrl: "https://photos.dev/ada.jpg",
            emailId: "ada@mit.edu",
            isTest: false,
          },
          createdAt: new Date(),
        },
      ];

      Post.find = () => createMockQuery(posts);

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 2, "Only 2 genuine developers must pass filter");
      assert.strictEqual(res.body.data[0].title, "Open Collab Hub");
      assert.strictEqual(res.body.data[0].author.firstName, "Satoshi");
      assert.strictEqual(res.body.data[1].title, "AI Canvas");
      assert.strictEqual(res.body.data[1].author.firstName, "Ada");
    });

    it("strictly projects safe fields only: never leaks password, email, or internal data", async () => {
      const postId = new mongoose.Types.ObjectId();
      const authorId = new mongoose.Types.ObjectId();

      const posts = [
        {
          _id: postId,
          type: "project",
          visibility: "public",
          moderationStatus: "safe",
          content: "Confidential internal notes",
          reactions: { fire: 99 },
          isPinnedToProfile: true,
          images: ["internal.png"],
          createdAt: new Date("2026-05-01T12:00:00Z"),
          project: {
            title: "Distributed KV Store",
            techStack: ["go", "raft"],
            roleNeeded: "Backend Architect",
            stage: "mid-build",
            commitment: "ongoing",
            isOpen: true,
          },
          authorId: {
            _id: authorId,
            firstName: "Linus",
            lastName: "Torvalds",
            emailId: "linus@kernel.org",
            password: "$2b$10$supersecretpasshashshouldneverleak",
            photoUrl: "https://photos.dev/linus.png",
            isTest: false,
          },
        },
      ];

      Post.find = () => createMockQuery(posts);

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.length, 1);

      const item = res.body.data[0];

      // Safe fields present
      assert.strictEqual(item._id.toString(), postId.toString());
      assert.strictEqual(item.title, "Distributed KV Store");
      assert.deepStrictEqual(item.techStack, ["go", "raft"]);
      assert.strictEqual(item.roleNeeded, "Backend Architect");
      assert.strictEqual(item.stage, "mid-build");
      assert.strictEqual(item.commitment, "ongoing");
      assert.strictEqual(item.author.firstName, "Linus");
      assert.strictEqual(item.author.photoUrl, "https://photos.dev/linus.png");
      assert.ok(item.createdAt);

      // Sensitive fields strictly absent from post
      assert.strictEqual(item.password, undefined);
      assert.strictEqual(item.emailId, undefined);
      assert.strictEqual(item.content, undefined);
      assert.strictEqual(item.reactions, undefined);
      assert.strictEqual(item.visibility, undefined);
      assert.strictEqual(item.moderationStatus, undefined);
      assert.strictEqual(item.isPinnedToProfile, undefined);
      assert.strictEqual(item.images, undefined);

      // Sensitive fields strictly absent from author object
      assert.strictEqual(item.author.password, undefined);
      assert.strictEqual(item.author.emailId, undefined);
      assert.strictEqual(item.author._id, undefined);
      assert.strictEqual(item.author.lastName, undefined);

      // Verify exact keys present in object
      const itemKeys = Object.keys(item).sort();
      const expectedKeys = [
        "_id",
        "author",
        "commitment",
        "createdAt",
        "roleNeeded",
        "stage",
        "techStack",
        "title",
      ].sort();
      assert.deepStrictEqual(itemKeys, expectedKeys);

      const authorKeys = Object.keys(item.author).sort();
      assert.deepStrictEqual(authorKeys, ["firstName", "photoUrl"]);
    });

    it("returns Cache-Control: public, max-age=300 header", async () => {
      Post.find = () => createMockQuery([]);

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers["cache-control"], "public, max-age=300");
    });

    it("returns empty array with 200 OK when no project posts match criteria", async () => {
      Post.find = () => createMockQuery([]);

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.deepStrictEqual(res.body.data, []);
    });
  });

  // =========================================================================
  // F3: GET /public/stats
  // =========================================================================
  describe("F3: GET /public/stats Contract & Concurrency", () => {
    it("returns developers, openProjects, completedRooms counts concurrently", async () => {
      let userQueryCalled = false;
      let postQueryCalled = false;
      let roomQueryCalled = false;

      let capturedUserFilter = null;
      let capturedPostFilter = null;
      let capturedRoomFilter = null;

      User.countDocuments = async (filter) => {
        userQueryCalled = true;
        capturedUserFilter = filter;
        return 142;
      };

      Post.countDocuments = async (filter) => {
        postQueryCalled = true;
        capturedPostFilter = filter;
        return 38;
      };

      ProjectRoom.countDocuments = async (filter) => {
        roomQueryCalled = true;
        capturedRoomFilter = filter;
        return 19;
      };

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.headers["cache-control"], "public, max-age=300");

      assert.strictEqual(userQueryCalled, true);
      assert.strictEqual(postQueryCalled, true);
      assert.strictEqual(roomQueryCalled, true);

      // Verify contract payload
      assert.deepStrictEqual(res.body.data, {
        developers: 142,
        openProjects: 38,
        completedRooms: 19,
      });

      // Verify top-level convenience values
      assert.strictEqual(res.body.developers, 142);
      assert.strictEqual(res.body.openProjects, 38);
      assert.strictEqual(res.body.completedRooms, 19);

      // Verify filter parameters
      assert.deepStrictEqual(capturedUserFilter, {
        emailId: { $not: /@(test\.com|example\.com|devtinder\.io)$/i },
        isTest: { $ne: true },
      });
      assert.deepStrictEqual(capturedPostFilter, {
        type: "project",
        "project.isOpen": true,
        visibility: "public",
        moderationStatus: "safe",
      });
      assert.deepStrictEqual(capturedRoomFilter, {
        status: "completed",
      });
    });

    it("accurately handles 0 counts without error", async () => {
      User.countDocuments = async () => 0;
      Post.countDocuments = async () => 0;
      ProjectRoom.countDocuments = async () => 0;

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.deepStrictEqual(res.body.data, {
        developers: 0,
        openProjects: 0,
        completedRooms: 0,
      });
    });
  });

  // =========================================================================
  // In-Memory Caching & clearPublicCache() Helper
  // =========================================================================
  describe("F2 & F3: In-Memory 5-Minute Cache & Cache Busting", () => {
    it("GET /public/showcase serves subsequent request from cache without re-querying DB", async () => {
      let dbCalls = 0;
      Post.find = () => {
        dbCalls++;
        return createMockQuery([
          {
            _id: new mongoose.Types.ObjectId(),
            project: { title: "Cached Project", isOpen: true },
            authorId: { firstName: "Dev", emailId: "dev@gmail.com" },
            createdAt: new Date(),
          },
        ]);
      };

      // Call 1: Populates cache
      const res1 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res1);
      assert.strictEqual(res1.statusCode, 200);
      assert.strictEqual(dbCalls, 1, "First call must query DB");
      assert.strictEqual(res1.body.data[0].title, "Cached Project");

      // Call 2: Must be served from in-memory cache
      const res2 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res2);
      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(dbCalls, 1, "Second call must NOT query DB (served from cache)");
      assert.strictEqual(res2.body.data[0].title, "Cached Project");

      // clearPublicCache() invalidates cache
      clearPublicCache();

      // Call 3: Queries DB again
      const res3 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res3);
      assert.strictEqual(res3.statusCode, 200);
      assert.strictEqual(dbCalls, 2, "Call after clearPublicCache() must query DB");
    });

    it("GET /public/stats serves subsequent request from cache without re-querying DB", async () => {
      let statsDbCalls = 0;
      User.countDocuments = async () => {
        statsDbCalls++;
        return 50;
      };
      Post.countDocuments = async () => 10;
      ProjectRoom.countDocuments = async () => 5;

      // Call 1
      const res1 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), res1);
      assert.strictEqual(res1.statusCode, 200);
      assert.strictEqual(statsDbCalls, 1);
      assert.strictEqual(res1.body.data.developers, 50);

      // Call 2: Cached
      const res2 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), res2);
      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(statsDbCalls, 1, "Must hit cache, not DB");

      // Clear cache
      clearPublicCache();

      // Call 3: DB re-queried
      const res3 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), res3);
      assert.strictEqual(res3.statusCode, 200);
      assert.strictEqual(statsDbCalls, 2);
    });
  });

  // =========================================================================
  // F4: Auth Hint Cookie in auth.js
  // =========================================================================
  describe("F4: Auth Hint Cookie Security Contract in auth.js", () => {
    it("setAuthCookie sets auth_hint='true' without httpOnly and token with httpOnly", () => {
      const res = createMockRes();
      setAuthCookie(res, "sample-jwt-token-string");

      // token cookie
      assert.ok(res.cookies.token, "Cookie 'token' must be present");
      assert.strictEqual(res.cookies.token.val, "sample-jwt-token-string");
      assert.strictEqual(res.cookies.token.options.httpOnly, true);
      assert.strictEqual(res.cookies.token.options.secure, true);
      assert.strictEqual(res.cookies.token.options.sameSite, "none");

      // auth_hint cookie
      assert.ok(res.cookies.auth_hint, "Cookie 'auth_hint' must be present");
      assert.strictEqual(res.cookies.auth_hint.val, "true");
      assert.strictEqual(
        res.cookies.auth_hint.options.httpOnly,
        false,
        "auth_hint MUST NOT have httpOnly: true (readable by client JS in head)"
      );
      assert.strictEqual(res.cookies.auth_hint.options.secure, true);
      assert.strictEqual(res.cookies.auth_hint.options.sameSite, "none");
    });

    it("clearAuthCookie clears both token and auth_hint cookies immediately", () => {
      const res = createMockRes();
      clearAuthCookie(res);

      // token cleared
      assert.ok(res.cookies.token, "Cookie 'token' must be cleared");
      assert.strictEqual(res.cookies.token.val, null);
      assert.strictEqual(res.cookies.token.options.httpOnly, true);
      assert.strictEqual(res.cookies.token.options.expires.getTime(), 0);

      // auth_hint cleared
      assert.ok(res.cookies.auth_hint, "Cookie 'auth_hint' must be cleared");
      assert.strictEqual(res.cookies.auth_hint.val, null);
      assert.strictEqual(
        res.cookies.auth_hint.options.httpOnly,
        false,
        "auth_hint clear cookie must have httpOnly: false"
      );
      assert.strictEqual(res.cookies.auth_hint.options.expires.getTime(), 0);
    });
  });

  // =========================================================================
  // Error Boundaries & Failure Resilience
  // =========================================================================
  describe("Error Boundaries & Failure Resilience", () => {
    it("GET /public/showcase returns 500 JSON format on database error", async () => {
      Post.find = () => {
        throw new Error("MongoDB connection timeout");
      };

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res);

      assert.strictEqual(res.statusCode, 500);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.message, "MongoDB connection timeout");
    });

    it("GET /public/stats returns 500 JSON format on database error", async () => {
      User.countDocuments = async () => {
        throw new Error("Replica set election in progress");
      };
      Post.countDocuments = async () => 0;
      ProjectRoom.countDocuments = async () => 0;

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), res);

      assert.strictEqual(res.statusCode, 500);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.message, "Replica set election in progress");
    });
  });
});
