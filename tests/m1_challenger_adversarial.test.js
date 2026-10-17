const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const ConnectionRequest = require("../models/connectionRequest");
const Message = require("../models/Message");
const Post = require("../models/Post");

const authRouter = require("../routes/auth");
const profileRouter = require("../routes/profile");
const chatRouter = require("../routes/chat");
const userRouter = require("../routes/user");
const requestRouter = require("../routes/request");
const postRouter = require("../routes/postRouter");
const publicRouter = require("../routes/publicProfile");

const Notification = require("../models/Notification");

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    cookies: {},
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
  };
  return res;
}

function getHandler(router, path, method = "get") {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("Empirical Challenger M1: Backend Adversarial & Stress Verification", () => {
  beforeEach(() => {
    process.env.JWT_SECRET_KEY = "challenger-m1-secret-key-audit";
    Notification.create = async () => ({
      populate: async () => ({
        fromUserId: { firstName: "Test", lastName: "User", photoUrl: "test.png" },
      }),
    });
    Message.updateMany = async () => {};
  });

  // =========================================================================
  // 1. Password Hash Leak Prevention
  // =========================================================================
  describe("1. Password Hash Leak Prevention Audit", () => {
    it("POST /signup response body JSON strictly omits password hash", async () => {
      const signupHandler = getHandler(authRouter, "/signup", "post");
      const fakeId = new mongoose.Types.ObjectId();

      const origSave = User.prototype.save;
      User.prototype.save = async function () {
        this._id = fakeId;
        return this;
      };

      try {
        const req = {
          body: {
            firstName: "Ada",
            lastName: "Lovelace",
            emailId: "ada.lovelace@devtinder.io",
            password: "SecurePassword123!",
          },
        };
        const res = createMockRes();

        await signupHandler(req, res);

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.success, true);

        // Crucial empirical verification:
        // Even if res.body.data is a Mongoose doc, JSON serialization must purge password
        const serializedPayload = JSON.parse(JSON.stringify(res.body));
        assert.strictEqual(serializedPayload.password, undefined, "Root must not contain password");
        assert.strictEqual(serializedPayload.data.password, undefined, "data object must not contain password");
        assert.strictEqual(serializedPayload.data.emailId, "ada.lovelace@devtinder.io");
        assert.strictEqual(JSON.stringify(serializedPayload).includes("SecurePassword123!"), false);
      } finally {
        User.prototype.save = origSave;
      }
    });

    it("POST /login response payload strictly omits password at both root and data levels", async () => {
      const loginHandler = getHandler(authRouter, "/login", "post");
      const user = new User({
        _id: new mongoose.Types.ObjectId(),
        firstName: "Bjarne",
        lastName: "Stroustrup",
        emailId: "bjarne@cpp.org",
        password: "$2b$10$hashedpasswordhere1234567890",
      });

      const origFindOne = User.findOne;
      User.findOne = async () => user;
      user.validatePassword = async () => true;

      try {
        const req = {
          body: { emailId: "bjarne@cpp.org", password: "Password123!" },
        };
        const res = createMockRes();

        await loginHandler(req, res);

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.password, undefined, "Root must not expose password");
        assert.strictEqual(res.body.data.password, undefined, "Data must not expose password");

        const jsonStr = JSON.stringify(res.body);
        assert.strictEqual(jsonStr.includes("hashedpassword"), false, "Raw JSON must never contain password string");
      } finally {
        User.findOne = origFindOne;
      }
    });

    it("GET /profile/view strictly omits password hash across root and data", async () => {
      const profileHandler = getHandler(profileRouter, "/profile/view", "get");
      const user = new User({
        _id: new mongoose.Types.ObjectId(),
        firstName: "Ken",
        lastName: "Thompson",
        emailId: "ken@unix.bell",
        password: "$2b$10$verysecurehashstoredinmongodb",
      });

      const req = { user };
      const res = createMockRes();

      await profileHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.password, undefined);
      assert.strictEqual(res.body.data.password, undefined);

      const jsonStr = JSON.stringify(res.body);
      assert.strictEqual(jsonStr.includes("verysecurehash"), false);
    });

    it("User.toJSON() and User.toObject() both strip password field", () => {
      const user = new User({
        firstName: "Dennis",
        lastName: "Ritchie",
        emailId: "dennis@c.lang",
        password: "$2b$10$supersecretcprogramminghash",
      });

      const json = user.toJSON();
      assert.strictEqual(json.password, undefined);

      const obj = user.toObject();
      assert.strictEqual(obj.password, undefined);
    });
  });

  // =========================================================================
  // 2. Reciprocal Connection Request Rejection & State Flow
  // =========================================================================
  describe("2. Reciprocal Connection Request Rejection & Mutual Match", () => {
    it("Model pre('save') hook blocks direct reciprocal request (B -> A when A -> B exists)", async () => {
      const userA = new mongoose.Types.ObjectId();
      const userB = new mongoose.Types.ObjectId();

      const origFindOne = ConnectionRequest.findOne;
      // Simulate that an existing request from A -> B exists
      ConnectionRequest.findOne = async (q) => {
        return {
          _id: new mongoose.Types.ObjectId(),
          fromUserId: userA,
          toUserId: userB,
          status: "interested",
        };
      };

      try {
        // Now B tries to create a new request to A
        const reciprocalReq = new ConnectionRequest({
          fromUserId: userB,
          toUserId: userA,
          status: "interested",
        });

        await assert.rejects(
          async () => {
            await reciprocalReq.save();
          },
          /Connection request already exists between these users!/
        );
      } finally {
        ConnectionRequest.findOne = origFindOne;
      }
    });

    it("Model pre('save') hook blocks duplicate request in the same direction (A -> B)", async () => {
      const userA = new mongoose.Types.ObjectId();
      const userB = new mongoose.Types.ObjectId();

      const origFindOne = ConnectionRequest.findOne;
      ConnectionRequest.findOne = async () => ({
        _id: new mongoose.Types.ObjectId(),
        fromUserId: userA,
        toUserId: userB,
        status: "interested",
      });

      try {
        const duplicateReq = new ConnectionRequest({
          fromUserId: userA,
          toUserId: userB,
          status: "interested",
        });

        await assert.rejects(
          async () => {
            await duplicateReq.save();
          },
          /Connection request already exists between these users!/
        );
      } finally {
        ConnectionRequest.findOne = origFindOne;
      }
    });

    it("Model pre('save') hook rejects self-request (A -> A)", async () => {
      const userA = new mongoose.Types.ObjectId();
      const selfReq = new ConnectionRequest({
        fromUserId: userA,
        toUserId: userA,
        status: "interested",
      });

      await assert.rejects(
        async () => {
          await selfReq.save();
        },
        /Can't send connection request to yourself!/
      );
    });

    it("POST /request/send triggers mutual match when B sends interested back to A", async () => {
      const sendHandler = getHandler(requestRouter, "/request/send/:status/:toUserId", "post");
      const userA = new mongoose.Types.ObjectId();
      const userB = new mongoose.Types.ObjectId();

      const existingReq = {
        _id: new mongoose.Types.ObjectId(),
        fromUserId: userA,
        toUserId: userB,
        status: "interested",
        save: async function () {
          return this;
        },
      };

      const origFindOne = ConnectionRequest.findOne;
      const origFindById = User.findById;
      const origNotifCreate = Notification.create;
      ConnectionRequest.findOne = async () => existingReq;
      User.findById = async () => ({ _id: userA, firstName: "Alice" });
      Notification.create = async () => ({
        populate: async () => ({}),
      });

      try {
        // User B sends 'interested' to User A
        const req = {
          user: { _id: userB },
          params: { status: "interested", toUserId: userA.toString() },
          app: { get: () => null },
        };
        const res = createMockRes();

        await sendHandler(req, res);

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.isMatch, true);
        assert.strictEqual(existingReq.status, "accepted", "Status must become accepted");
      } finally {
        ConnectionRequest.findOne = origFindOne;
        User.findById = origFindById;
        Notification.create = origNotifCreate;
      }
    });

    it("POST /request/send rejects sending request when connection is already accepted", async () => {
      const sendHandler = getHandler(requestRouter, "/request/send/:status/:toUserId", "post");
      const userA = new mongoose.Types.ObjectId();
      const userB = new mongoose.Types.ObjectId();

      const existingReq = {
        _id: new mongoose.Types.ObjectId(),
        fromUserId: userA,
        toUserId: userB,
        status: "accepted",
      };

      const origFindOne = ConnectionRequest.findOne;
      const origFindById = User.findById;
      ConnectionRequest.findOne = async () => existingReq;
      User.findById = async () => ({ _id: userB, firstName: "Bob" });

      try {
        // User A tries to send again
        const req = {
          user: { _id: userA },
          params: { status: "interested", toUserId: userB.toString() },
          app: { get: () => null },
        };
        const res = createMockRes();

        await sendHandler(req, res);

        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(res.body.message, "Connection Request Already Exists!");
      } finally {
        ConnectionRequest.findOne = origFindOne;
        User.findById = origFindById;
      }
    });
  });

  // =========================================================================
  // 3. Age Field Schema Validation
  // =========================================================================
  describe("3. Age Field Schema Validation: Boundary & Type Audits", () => {
    it("rejects age < 16 across boundary values [15, 0, -10, 15.99]", () => {
      const testCases = [15, 0, -1, -10, 15.99];

      for (const age of testCases) {
        const user = new User({
          firstName: "BoundaryTest",
          emailId: `age_${age}@test.com`,
          password: "ValidPassword123!",
          age: age,
        });

        const err = user.validateSync();
        assert.ok(err, `Age ${age} must fail validation`);
        assert.ok(err.errors.age, `Error on age path expected for age ${age}`);
        assert.strictEqual(err.errors.age.kind, "min", `Validator kind must be 'min' for age ${age}`);
      }
    });

    it("rejects non-numeric values for age ['fifteen', 'not-a-number', NaN, {}]", () => {
      const testCases = ["fifteen", "not-a-number", NaN, {}];

      for (const age of testCases) {
        const user = new User({
          firstName: "NonNumberTest",
          emailId: "nonnum@test.com",
          password: "ValidPassword123!",
          age: age,
        });

        const err = user.validateSync();
        assert.ok(err, `Non-number age '${age}' must fail validation`);
        assert.ok(err.errors.age, `CastError on age path expected for '${age}'`);
        assert.strictEqual(err.errors.age.name, "CastError");
      }
    });

    it("accepts valid ages >= 16 [16, 17, 25, 99, '16']", () => {
      const testCases = [16, 17, 25, 99, "16"];

      for (const age of testCases) {
        const user = new User({
          firstName: "ValidAgeTest",
          emailId: `valid_${age}@test.com`,
          password: "ValidPassword123!",
          age: age,
        });

        const err = user.validateSync();
        assert.strictEqual(err, undefined, `Age ${age} should pass validation without error`);
        assert.strictEqual(typeof user.age, "number", `Age should be stored as Number type`);
        assert.ok(user.age >= 16);
      }
    });

    it("accepts undefined age (age is an optional field)", () => {
      const user = new User({
        firstName: "NoAgeUser",
        emailId: "noage@test.com",
        password: "ValidPassword123!",
      });

      const err = user.validateSync();
      assert.strictEqual(err, undefined, "Undefined age must be valid");
    });

    it("POST /profile/edit rejects age < 16 with standardized JSON error", async () => {
      const editHandler = getHandler(profileRouter, "/profile/edit", "post");
      const loggedInUser = new User({
        firstName: "Alice",
        emailId: "alice@test.com",
        password: "ValidPassword123!",
        age: 20,
      });

      const req = {
        user: loggedInUser,
        body: { age: 14 },
      };
      const res = createMockRes();

      await editHandler(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.message.includes("16"), "Error message should mention minimum age 16");
    });
  });

  // =========================================================================
  // 4. Chat Pagination Sort Order
  // =========================================================================
  describe("4. Chat Pagination Sort Order & Boundary Conditions", () => {
    it("GET /chat/:targetId sorts messages by createdAt: -1 (newest first)", async () => {
      const chatHandler = getHandler(chatRouter, "/chat/:targetId", "get");
      const loggedInUserId = new mongoose.Types.ObjectId();
      const targetUserId = new mongoose.Types.ObjectId();

      // Create 5 mock messages with chronological timestamps
      const m1 = { _id: "m1", text: "Oldest 10:00", createdAt: new Date("2026-10-01T10:00:00Z") };
      const m2 = { _id: "m2", text: "Older 10:05", createdAt: new Date("2026-10-01T10:05:00Z") };
      const m3 = { _id: "m3", text: "Mid 10:10", createdAt: new Date("2026-10-01T10:10:00Z") };
      const m4 = { _id: "m4", text: "Newer 10:15", createdAt: new Date("2026-10-01T10:15:00Z") };
      const m5 = { _id: "m5", text: "Newest 10:20", createdAt: new Date("2026-10-01T10:20:00Z") };
      const allMessages = [m1, m2, m3, m4, m5];

      const origReqFindOne = ConnectionRequest.findOne;
      const origUserFindById = User.findById;
      const origMsgFind = Message.find;
      const origMsgUpdateMany = Message.updateMany;

      ConnectionRequest.findOne = async () => ({ status: "accepted" });
      User.findById = () => ({
        select: async () => ({ firstName: "Bob", lastName: "Smith" }),
      });
      Message.updateMany = async () => {};

      let capturedSort = null;
      let capturedSkip = null;
      let capturedLimit = null;

      Message.find = () => ({
        sort(sortObj) {
          capturedSort = sortObj;
          return {
            skip(skipNum) {
              capturedSkip = skipNum;
              return {
                limit(limitNum) {
                  capturedLimit = limitNum;
                  return {
                    populate: async () => {
                      // Simulate MongoDB execution with sort { createdAt: -1 }, skip, limit
                      const sorted = [...allMessages].sort((a, b) => {
                        return sortObj.createdAt === -1
                          ? b.createdAt - a.createdAt
                          : a.createdAt - b.createdAt;
                      });
                      return sorted.slice(skipNum, skipNum + limitNum);
                    },
                  };
                },
              };
            },
          };
        },
      });

      try {
        // Page 1 with limit 2
        const req1 = {
          user: { _id: loggedInUserId },
          params: { targetId: targetUserId.toString() },
          query: { page: "1", limit: "2" },
        };
        const res1 = createMockRes();

        await chatHandler(req1, res1);

        assert.strictEqual(res1.statusCode, 200);
        assert.strictEqual(res1.body.success, true);
        assert.deepStrictEqual(capturedSort, { createdAt: -1 }, "Sort must be descending createdAt: -1");
        assert.strictEqual(capturedSkip, 0);
        assert.strictEqual(capturedLimit, 2);

        // Verify Page 1 gets newest messages [m5, m4]
        assert.strictEqual(res1.body.messages.length, 2);
        assert.strictEqual(res1.body.messages[0]._id, "m5", "First message must be the newest (m5)");
        assert.strictEqual(res1.body.messages[1]._id, "m4", "Second message must be m4");
        assert.ok(
          res1.body.messages[0].createdAt > res1.body.messages[1].createdAt,
          "Messages must be strictly descending by time"
        );

        // Page 2 with limit 2
        const req2 = {
          user: { _id: loggedInUserId },
          params: { targetId: targetUserId.toString() },
          query: { page: "2", limit: "2" },
        };
        const res2 = createMockRes();

        await chatHandler(req2, res2);

        assert.strictEqual(res2.statusCode, 200);
        assert.strictEqual(capturedSkip, 2);
        assert.strictEqual(res2.body.messages.length, 2);
        assert.strictEqual(res2.body.messages[0]._id, "m3");
        assert.strictEqual(res2.body.messages[1]._id, "m2");

        // Page 3 with limit 2
        const req3 = {
          user: { _id: loggedInUserId },
          params: { targetId: targetUserId.toString() },
          query: { page: "3", limit: "2" },
        };
        const res3 = createMockRes();

        await chatHandler(req3, res3);

        assert.strictEqual(res3.statusCode, 200);
        assert.strictEqual(capturedSkip, 4);
        assert.strictEqual(res3.body.messages.length, 1);
        assert.strictEqual(res3.body.messages[0]._id, "m1", "Page 3 gets oldest message m1");
      } finally {
        ConnectionRequest.findOne = origReqFindOne;
        User.findById = origUserFindById;
        Message.find = origMsgFind;
        Message.updateMany = origMsgUpdateMany;
      }
    });

    it("GET /chat/:targetId rejects chat between non-accepted users with 403 JSON", async () => {
      const chatHandler = getHandler(chatRouter, "/chat/:targetId", "get");
      const origReqFindOne = ConnectionRequest.findOne;
      ConnectionRequest.findOne = async () => null; // Not connected

      try {
        const req = {
          user: { _id: new mongoose.Types.ObjectId() },
          params: { targetId: new mongoose.Types.ObjectId().toString() },
          query: {},
        };
        const res = createMockRes();

        await chatHandler(req, res);

        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(res.body.message, "You can only chat with your connections.");
      } finally {
        ConnectionRequest.findOne = origReqFindOne;
      }
    });

    it("chat pagination boundary guard: page=0 falls back to page 1 producing skip 0", async () => {
      const chatHandler = getHandler(chatRouter, "/chat/:targetId", "get");
      const origReqFindOne = ConnectionRequest.findOne;
      const origUserFindById = User.findById;
      const origMsgFind = Message.find;

      ConnectionRequest.findOne = async () => ({ status: "accepted" });
      User.findById = () => ({
        select: async () => ({ firstName: "Bob" }),
      });

      let computedSkip = null;
      Message.find = () => ({
        sort: () => ({
          skip: (s) => {
            computedSkip = s;
            return {
              limit: () => ({
                populate: async () => [],
              }),
            };
          },
        }),
      });

      try {
        const req = {
          user: { _id: new mongoose.Types.ObjectId() },
          params: { targetId: new mongoose.Types.ObjectId().toString() },
          query: { page: "0", limit: "50" },
        };
        const res = createMockRes();

        await chatHandler(req, res);

        // Note: In routes/chat.js: parseInt(req.query.page) is 0.
        // parseInt(0) || 1 evaluates to 1 because 0 is falsy!
        // So parseInt("0") || 1 evaluates to: parseInt("0") is 0, which is falsy, fallback to 1!
        // Let's verify what computedSkip was:
        assert.strictEqual(computedSkip, 0, "Falsy 0 falls back to 1, producing skip 0");
      } finally {
        ConnectionRequest.findOne = origReqFindOne;
        User.findById = origUserFindById;
        Message.find = origMsgFind;
      }
    });

    it("chat pagination boundary guard: page=-1 produces non-negative skip 0", async () => {
      const chatHandler = getHandler(chatRouter, "/chat/:targetId", "get");
      const origReqFindOne = ConnectionRequest.findOne;
      const origUserFindById = User.findById;
      const origMsgFind = Message.find;

      ConnectionRequest.findOne = async () => ({ status: "accepted" });
      User.findById = () => ({
        select: async () => ({ firstName: "Bob" }),
      });

      let computedSkip = null;
      Message.find = () => ({
        sort: () => ({
          skip: (s) => {
            computedSkip = s;
            return {
              limit: () => ({
                populate: async () => [],
              }),
            };
          },
        }),
      });

      try {
        const req = {
          user: { _id: new mongoose.Types.ObjectId() },
          params: { targetId: new mongoose.Types.ObjectId().toString() },
          query: { page: "-1", limit: "50" },
        };
        const res = createMockRes();

        await chatHandler(req, res);

        // Clamped pagination: pageNum >= 1 ensures skip >= 0
        assert.strictEqual(computedSkip, 0, "Guarded pagination clamps negative page to skip 0");
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.success, true);
      } finally {
        ConnectionRequest.findOne = origReqFindOne;
        User.findById = origUserFindById;
        Message.find = origMsgFind;
      }
    });
  });

  // =========================================================================
  // 5. JSON Error Format Standard Audit
  // =========================================================================
  describe("5. JSON Error Format Standardization & Missing success: false Audit", () => {
    it("auth and request routers return { message, success: false }", async () => {
      const loginHandler = getHandler(authRouter, "/login", "post");
      const origFindOne = User.findOne;
      User.findOne = async () => null;

      try {
        const req = { body: { emailId: "ghost@test.com", password: "Password1!" } };
        const res = createMockRes();

        await loginHandler(req, res);

        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body.success, false);
        assert.strictEqual(res.body.message, "Invalid Credentials");
      } finally {
        User.findOne = origFindOne;
      }
    });

    it("postRouter POST /post includes success: false on missing content", async () => {
      const postHandler = getHandler(postRouter, "/post", "post");
      const req = {
        user: { _id: new mongoose.Types.ObjectId() },
        body: {}, // empty content
      };
      const res = createMockRes();

      await postHandler(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.message, "Post content is required");
      assert.strictEqual(res.body.success, false, "postRouter returns success: false");
    });

    it("postRouter POST /post includes success: false for snippet without code", async () => {
      const postHandler = getHandler(postRouter, "/post", "post");
      const req = {
        user: { _id: new mongoose.Types.ObjectId() },
        body: { content: "Snippet title", type: "snippet" }, // missing codeSnippet
      };
      const res = createMockRes();

      await postHandler(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.message, "Snippet posts must contain code");
      assert.strictEqual(res.body.success, false, "snippet post error returns success: false");
    });

    it("publicProfile GET /user/:userId includes success: false on 404", async () => {
      const profileHandler = getHandler(publicRouter, "/user/:userId", "get");
      const origFindById = User.findById;
      User.findById = () => ({
        select: async () => null, // user not found
      });

      try {
        const req = {
          user: { _id: new mongoose.Types.ObjectId() },
          params: { userId: new mongoose.Types.ObjectId().toString() },
        };
        const res = createMockRes();

        await profileHandler(req, res);

        assert.strictEqual(res.statusCode, 404);
        assert.strictEqual(res.body.message, "User not found");
        assert.strictEqual(res.body.success, false, "publicProfile 404 returns success: false");
      } finally {
        User.findById = origFindById;
      }
    });
  });

  // =========================================================================
  // 6. Search Query Handling: Special Characters, Empty Query, Unicode
  // =========================================================================
  describe("6. Search Query Handling & Regex Injection / Crash Audit", () => {
    it("handles empty and whitespace query with 200 OK and empty array", async () => {
      const searchHandler = getHandler(userRouter, "/user/search", "get");

      for (const emptyQ of ["", "   ", "\t\n"]) {
        const req = {
          user: { _id: new mongoose.Types.ObjectId() },
          query: { q: emptyQ },
        };
        const res = createMockRes();

        await searchHandler(req, res);

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.success, true);
        assert.deepStrictEqual(res.body.data, []);
      }
    });

    it("handles unicode query strings gracefully without error", async () => {
      const searchHandler = getHandler(userRouter, "/user/search", "get");
      const origFind = User.find;
      let executedQuery = null;

      User.find = (q) => {
        executedQuery = q;
        return {
          select: () => ({
            limit: async () => [],
          }),
        };
      };

      try {
        const unicodeQueries = ["José", "田中", "Developer 🚀", "Müller"];

        for (const uq of unicodeQueries) {
          const req = {
            user: { _id: new mongoose.Types.ObjectId() },
            query: { q: uq },
          };
          const res = createMockRes();

          await searchHandler(req, res);

          assert.strictEqual(res.statusCode, 200);
          assert.strictEqual(res.body.success, true);
          assert.ok(executedQuery.$or, "Query must contain $or conditions");
        }
      } finally {
        User.find = origFind;
      }
    });

    it("safely handles special character query '.*+?' without 500 SyntaxError", async () => {
      const searchHandler = getHandler(userRouter, "/user/search", "get");
      const origFind = User.find;
      let executedQuery = null;

      User.find = (q) => {
        executedQuery = q;
        return {
          select: () => ({
            limit: async () => [],
          }),
        };
      };

      try {
        const req = {
          user: { _id: new mongoose.Types.ObjectId() },
          query: { q: ".*+?" },
        };
        const res = createMockRes();

        await searchHandler(req, res);

        assert.strictEqual(res.statusCode, 200, "Safely returns 200 for '.*+?' without throwing");
        assert.strictEqual(res.body.success, true);
        assert.deepStrictEqual(res.body.data, []);
        assert.ok(executedQuery.$or[0].firstName instanceof RegExp);
      } finally {
        User.find = origFind;
      }
    });

    it("safely handles developer searching for 'C++' without 500 SyntaxError", async () => {
      const searchHandler = getHandler(userRouter, "/user/search", "get");
      const origFind = User.find;
      let executedQuery = null;

      User.find = (q) => {
        executedQuery = q;
        return {
          select: () => ({
            limit: async () => [{ firstName: "Bjarne", skills: ["C++"] }],
          }),
        };
      };

      try {
        const req = {
          user: { _id: new mongoose.Types.ObjectId() },
          query: { q: "C++" },
        };
        const res = createMockRes();

        await searchHandler(req, res);

        assert.strictEqual(res.statusCode, 200, "Safely returns 200 for developer searching 'C++'");
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.data.length, 1);
        const regex = executedQuery.$or[2].skills;
        assert.strictEqual(regex.test("C++"), true, "Escaped regex matches literal 'C++'");
        assert.strictEqual(regex.test("C"), false, "Escaped regex does not treat + as quantifier");
      } finally {
        User.find = origFind;
      }
    });

    it("safely handles searching '[' or '(' or '*' or '\\' without 500 SyntaxError", async () => {
      const searchHandler = getHandler(userRouter, "/user/search", "get");
      const adversarialChars = ["[", "(", "*", "\\", "+"];
      const origFind = User.find;

      User.find = () => ({
        select: () => ({
          limit: async () => [],
        }),
      });

      try {
        for (const char of adversarialChars) {
          const req = {
            user: { _id: new mongoose.Types.ObjectId() },
            query: { q: char },
          };
          const res = createMockRes();

          await searchHandler(req, res);

          assert.strictEqual(res.statusCode, 200, `Query '${char}' must succeed with 200 OK`);
          assert.strictEqual(res.body.success, true);
          assert.deepStrictEqual(res.body.data, []);
        }
      } finally {
        User.find = origFind;
      }
    });

    it("escaped query '.*' matches literal '.*' and does not overmatch all users", async () => {
      const searchHandler = getHandler(userRouter, "/user/search", "get");
      const origFind = User.find;
      let regexPattern = null;

      User.find = (q) => {
        regexPattern = q.$or[0].firstName;
        return {
          select: () => ({
            limit: async () => [],
          }),
        };
      };

      try {
        const req = {
          user: { _id: new mongoose.Types.ObjectId() },
          query: { q: ".*" },
        };
        const res = createMockRes();

        await searchHandler(req, res);

        assert.strictEqual(res.statusCode, 200);
        // regexPattern is escaped: /\.\*/i
        assert.strictEqual(regexPattern.test(".*"), true, "Matches literal '.*'");
        assert.strictEqual(regexPattern.test("random"), false, "Does not match arbitrary strings");
        assert.strictEqual(regexPattern.test(""), false, "Does not match empty string");
      } finally {
        User.find = origFind;
      }
    });
  });
});
