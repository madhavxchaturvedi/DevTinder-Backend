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

describe("Empirical Challenger M1: Adversarial & Stress Suite", () => {
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
  // 1. DATA LEAKAGE ADVERSARIAL AUDIT
  // =========================================================================
  describe("1. Data Leakage & Secret Exfiltration Audit", () => {
    it("never leaks passwords, hashes, salts, email addresses, or JWT secrets in /showcase", async () => {
      const toxicPost = {
        _id: new mongoose.Types.ObjectId(),
        type: "project",
        visibility: "public",
        moderationStatus: "safe",
        content: "TOP SECRET CONTENT - MUST NOT LEAK",
        reactions: { fire: 10, bug: 2 },
        codeSnippet: { language: "js", code: "const apiSecret = '12345';" },
        images: ["secret-diagram.png"],
        documentUrl: "https://internal.vault/doc.pdf",
        forkedFrom: new mongoose.Types.ObjectId(),
        rootPostId: new mongoose.Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        project: {
          title: "Public Project Alpha",
          techStack: ["react", "node"],
          roleNeeded: "Backend Architect",
          stage: "mid-build",
          commitment: "ongoing",
          isOpen: true,
          internalNotes: "DO NOT EXPOSE THIS NOTE",
        },
        authorId: {
          _id: new mongoose.Types.ObjectId(),
          firstName: "Ada",
          lastName: "Lovelace",
          emailId: "ada@genuine-dev.org",
          password: "$2b$10$toxicPasswordHashShouldNeverLeakToClients",
          photoUrl: "https://photos.dev/ada.png",
          age: 36,
          gender: "female",
          isPremium: true,
          headline: "Pioneer",
          location: "London",
          isTest: false,
        },
      };

      Post.find = () => createMockQuery([toxicPost]);

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 1);

      const returned = res.body.data[0];
      const serialized = JSON.stringify(res.body);

      // String-level audit across entire response payload
      assert.ok(!serialized.includes("toxicPasswordHash"), "Password hash MUST NOT appear in serialized response");
      assert.ok(!serialized.includes("ada@genuine-dev.org"), "Author email MUST NOT appear in serialized response");
      assert.ok(!serialized.includes("TOP SECRET CONTENT"), "Post content MUST NOT appear in serialized response");
      assert.ok(!serialized.includes("12345"), "Code snippet secret MUST NOT appear in serialized response");
      assert.ok(!serialized.includes("secret-diagram.png"), "Post images MUST NOT appear in serialized response");
      assert.ok(!serialized.includes("Lovelace"), "Author last name MUST NOT appear in serialized response");
      assert.ok(!serialized.includes("DO NOT EXPOSE THIS NOTE"), "Custom project fields MUST NOT appear in serialized response");

      // Key-level audit
      assert.strictEqual(returned.content, undefined);
      assert.strictEqual(returned.codeSnippet, undefined);
      assert.strictEqual(returned.images, undefined);
      assert.strictEqual(returned.documentUrl, undefined);
      assert.strictEqual(returned.forkedFrom, undefined);
      assert.strictEqual(returned.reactions, undefined);
      assert.strictEqual(returned.author.emailId, undefined);
      assert.strictEqual(returned.author.password, undefined);
      assert.strictEqual(returned.author.lastName, undefined);
      assert.strictEqual(returned.author._id, undefined);
      assert.strictEqual(returned.author.age, undefined);
      assert.strictEqual(returned.author.gender, undefined);
    });

    it("verifies GET /public/stats does not expose individual user records or IDs", async () => {
      User.countDocuments = async () => 105;
      Post.countDocuments = async () => 42;
      ProjectRoom.countDocuments = async () => 18;

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), res);

      assert.strictEqual(res.statusCode, 200);
      const keys = Object.keys(res.body).sort();
      // Should only contain success, data, and numeric counts
      assert.deepStrictEqual(keys, ["completedRooms", "data", "developers", "openProjects", "success"].sort());
      assert.strictEqual(typeof res.body.data.developers, "number");
      assert.strictEqual(typeof res.body.data.openProjects, "number");
      assert.strictEqual(typeof res.body.data.completedRooms, "number");
    });
  });

  // =========================================================================
  // 2. SEED ACCOUNT FILTER BYPASS RESILIENCE
  // =========================================================================
  describe("2. Seed & Test Account Filter Bypass Resilience", () => {
    it("thwarts attempts to bypass filter using mixed case or alternative seed domains", async () => {
      const posts = [
        // Case manipulation: TEST.COM
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Bypass Attempt 1", isOpen: true },
          authorId: { firstName: "Dev1", emailId: "user@TEST.COM", isTest: false },
        },
        // Case manipulation: ExAmPlE.cOm
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Bypass Attempt 2", isOpen: true },
          authorId: { firstName: "Dev2", emailId: "user@ExAmPlE.cOm", isTest: false },
        },
        // Devtinder.io domain
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Bypass Attempt 3", isOpen: true },
          authorId: { firstName: "Dev3", emailId: "staff@DevTinder.io", isTest: false },
        },
        // isTest = true
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Bypass Attempt 4", isOpen: true },
          authorId: { firstName: "Dev4", emailId: "realuser@gmail.com", isTest: true },
        },
        // Valid genuine user
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Genuine Builder Project", isOpen: true, techStack: ["go"] },
          authorId: { firstName: "GenuineDev", emailId: "valid@protonmail.ch", isTest: false },
        },
      ];

      Post.find = () => createMockQuery(posts);

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.length, 1, "Only the 1 genuine builder must pass");
      assert.strictEqual(res.body.data[0].title, "Genuine Builder Project");
    });

    it("handles corrupt author records gracefully (null, undefined, string, missing email)", async () => {
      const malformedPosts = [
        // null author
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Null Author", isOpen: true },
          authorId: null,
        },
        // undefined author
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Undefined Author", isOpen: true },
          authorId: undefined,
        },
        // primitive author (string ID not populated)
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Primitive String Author", isOpen: true },
          authorId: "64a0f1234567890abcdef123",
        },
        // Author with missing emailId
        {
          _id: new mongoose.Types.ObjectId(),
          project: { title: "Missing Email Author", isOpen: true },
          authorId: { firstName: "NoEmailUser", photoUrl: "https://photo.url" },
        },
      ];

      Post.find = () => createMockQuery(malformedPosts);

      const res = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      // Null, undefined, and primitive string author should be skipped (authorId must be an object)
      // Author with missing emailId (and not isTest) should be included safely
      assert.strictEqual(res.body.data.length, 1);
      assert.strictEqual(res.body.data[0].title, "Missing Email Author");
      assert.strictEqual(res.body.data[0].author.firstName, "NoEmailUser");
    });
  });

  // =========================================================================
  // 3. RATE LIMITING STRESS & BOUNDARY HARNESS
  // =========================================================================
  describe("3. Rate Limiter Stress & Rapid Request Harness", () => {
    it("handles burst of rapid repeated requests correctly up to quota", async () => {
      const testLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        statusCode: 429,
        handler: (req, res, next, options) => {
          res.status(options.statusCode || 429).json({
            message: "Too many requests from this IP, please try again later.",
            success: false,
          });
        },
        validate: { trustProxy: false, xForwardedForHeader: false },
      });

      const burstRouter = express.Router();
      burstRouter.use(testLimiter);
      burstRouter.get("/burst", (req, res) => res.json({ success: true, count: 1 }));

      const clientIp = "10.10.10.10";

      // Send 5 rapid requests (should all succeed)
      for (let i = 1; i <= 5; i++) {
        const res = createMockRes();
        await dispatchRouter(burstRouter, createMockReq({ url: "/burst", ip: clientIp }), res);
        assert.strictEqual(res.statusCode, 200, `Request ${i} must succeed`);
        assert.strictEqual(res.body.success, true);
      }

      // 6th request must be throttled with 429
      const throttledRes = createMockRes();
      await dispatchRouter(burstRouter, createMockReq({ url: "/burst", ip: clientIp }), throttledRes);
      assert.strictEqual(throttledRes.statusCode, 429, "6th request must be throttled");
      assert.strictEqual(throttledRes.body.success, false);
      assert.match(throttledRes.body.message, /Too many requests/i);
    });

    it("verifies publicLimiter is an express middleware function with standard configuration", () => {
      assert.strictEqual(typeof publicLimiter, "function");
      // express-rate-limit middleware takes (req, res, next)
      assert.strictEqual(publicLimiter.length, 3);
    });
  });

  // =========================================================================
  // 4. CACHE INVALIDATION & TTL EXPIRY HARNESS
  // =========================================================================
  describe("4. Cache Invalidation & Expiry Dynamics", () => {
    it("serves from cache on repeated requests and flushes deterministically via clearPublicCache()", async () => {
      let showcaseDbHits = 0;
      let statsDbHits = 0;

      Post.find = () => {
        showcaseDbHits++;
        return createMockQuery([
          {
            _id: new mongoose.Types.ObjectId(),
            project: { title: `Run ${showcaseDbHits}`, isOpen: true },
            authorId: { firstName: "Dev", emailId: "dev@domain.io" },
          },
        ]);
      };

      User.countDocuments = async () => {
        statsDbHits++;
        return 99;
      };
      Post.countDocuments = async () => 10;
      ProjectRoom.countDocuments = async () => 5;

      // 1. Initial requests populate cache
      const resShowcase1 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), resShowcase1);
      assert.strictEqual(showcaseDbHits, 1);

      const resStats1 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), resStats1);
      assert.strictEqual(statsDbHits, 1);

      // 2. Burst of 10 subsequent requests hit cache with zero additional DB queries
      for (let i = 0; i < 10; i++) {
        const resShowcase = createMockRes();
        await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), resShowcase);
        assert.strictEqual(resShowcase.statusCode, 200);
        assert.strictEqual(showcaseDbHits, 1, "Cache hit must not increment DB hits");

        const resStats = createMockRes();
        await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), resStats);
        assert.strictEqual(resStats.statusCode, 200);
        assert.strictEqual(statsDbHits, 1, "Cache hit must not increment DB hits");
      }

      // 3. Invalidate cache
      clearPublicCache();

      // 4. Next request must hit DB again
      const resShowcase2 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), resShowcase2);
      assert.strictEqual(showcaseDbHits, 2, "Post-flush request must query DB");

      const resStats2 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), resStats2);
      assert.strictEqual(statsDbHits, 2, "Post-flush request must query DB");
    });
  });

  // =========================================================================
  // 5. AUTH HINT COOKIE SECURITY CONTRACT & EXTENSION
  // =========================================================================
  describe("5. Auth Hint Cookie Flags & Lifecycle Contract", () => {
    it("setAuthCookie sets auth_hint with httpOnly: false, secure: true, sameSite: 'none'", () => {
      const res = createMockRes();
      setAuthCookie(res, "test-jwt-token");

      assert.ok(res.cookies.auth_hint, "auth_hint cookie must be set");
      assert.strictEqual(res.cookies.auth_hint.val, "true");
      assert.strictEqual(res.cookies.auth_hint.options.httpOnly, false);
      assert.strictEqual(res.cookies.auth_hint.options.secure, true);
      assert.strictEqual(res.cookies.auth_hint.options.sameSite, "none");

      // Verify token cookie is simultaneously set WITH httpOnly: true
      assert.ok(res.cookies.token, "token cookie must be set");
      assert.strictEqual(res.cookies.token.val, "test-jwt-token");
      assert.strictEqual(res.cookies.token.options.httpOnly, true);
      assert.strictEqual(res.cookies.token.options.secure, true);
      assert.strictEqual(res.cookies.token.options.sameSite, "none");
    });

    it("clearAuthCookie clears auth_hint and token with epoch 0 expiry", () => {
      const res = createMockRes();
      clearAuthCookie(res);

      assert.ok(res.cookies.auth_hint, "auth_hint must be cleared");
      assert.strictEqual(res.cookies.auth_hint.val, null);
      assert.strictEqual(res.cookies.auth_hint.options.httpOnly, false);
      assert.strictEqual(res.cookies.auth_hint.options.expires.getTime(), 0);

      assert.ok(res.cookies.token, "token must be cleared");
      assert.strictEqual(res.cookies.token.val, null);
      assert.strictEqual(res.cookies.token.options.httpOnly, true);
      assert.strictEqual(res.cookies.token.options.expires.getTime(), 0);
    });
  });

  // =========================================================================
  // 6. ROUTE PATH MATCHING & INTEGRATION
  // =========================================================================
  describe("6. Route Path Matching & Integration Verification", () => {
    it("handles both /showcase and /public/showcase paths on publicRouter", async () => {
      Post.find = () => createMockQuery([]);

      // Test path 1: /showcase (when router mounted at /public)
      const res1 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/showcase" }), res1);
      assert.strictEqual(res1.statusCode, 200);

      // Test path 2: /public/showcase (if path retains prefix)
      const res2 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/public/showcase" }), res2);
      assert.strictEqual(res2.statusCode, 200);
    });

    it("handles both /stats and /public/stats paths on publicRouter", async () => {
      User.countDocuments = async () => 10;
      Post.countDocuments = async () => 5;
      ProjectRoom.countDocuments = async () => 2;

      // Test path 1: /stats
      const res1 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/stats" }), res1);
      assert.strictEqual(res1.statusCode, 200);

      // Test path 2: /public/stats
      const res2 = createMockRes();
      await dispatchRouter(publicRouter, createMockReq({ url: "/public/stats" }), res2);
      assert.strictEqual(res2.statusCode, 200);
    });
  });
});
