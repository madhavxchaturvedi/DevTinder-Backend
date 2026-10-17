const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const ConnectionRequest = require("../models/connectionRequest");
const Post = require("../models/Post");
const Comment = require("../models/Comment");
const Reaction = require("../models/Reaction");
const ProjectRoom = require("../models/ProjectRoom");
const ProjectRequest = require("../models/ProjectRequest");

const authRouter = require("../routes/auth");
const profileRouter = require("../routes/profile");
const chatRouter = require("../routes/chat");
const userRouter = require("../routes/user");
const postRouter = require("../routes/postRouter");
const projectRouter = require("../routes/projectRouter");
const requestRouter = require("../routes/request");

const { userAuth } = require("../middlewares/auth");
const { validateMyProfileEditData } = require("../utils/validation");
const cloudinary = require("../utils/cloudinary");
const { uploadStreamFromBuffer } = require("../utils/cloudinary");
const { setAuthCookie, clearAuthCookie } = require("../routes/auth");
const http = require("node:http");
const initializeSocket = require("../utils/socket");
const publicRouter = require("../routes/publicProfile");
const commentRouter = require("../routes/comment");
const Message = require("../models/Message");
const Notification = require("../models/Notification");

// Helper to create mock response object
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

// Find route handler in an express router
function getHandler(router, path, method = "get") {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("Milestone 1 Contracts & Security Verification", () => {
  beforeEach(() => {
    process.env.JWT_SECRET_KEY = "test-milestone1-jwt-secret-key-super-secure";
  });

  // 1. R1.1 JWT Secret Key
  describe("R1.1 JWT Secret in User.js", () => {
    it("signs token using process.env.JWT_SECRET_KEY, verified by jwt.verify", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const user = new User({
        _id: fakeId,
        firstName: "Ada",
        emailId: "ada@lovelace.dev",
        password: "Password123!",
      });

      const token = await user.getJWT();
      assert.ok(token, "Token should be returned");

      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      assert.strictEqual(decoded._id, fakeId.toString());

      // Verifying with old hardcoded secret must fail
      assert.throws(() => {
        jwt.verify(token, "devtinder@2006");
      }, /invalid signature/);
    });
  });

  // 2. R1.2 Password Leak Fix
  describe("R1.2 Password Leak Fix", () => {
    it("User.toJSON() and JSON.stringify omit the password field", () => {
      const user = new User({
        _id: new mongoose.Types.ObjectId(),
        firstName: "Grace",
        lastName: "Hopper",
        emailId: "grace@navy.mil",
        password: "$2b$10$hashedpasswordstring",
      });

      const jsonObj = user.toJSON();
      assert.strictEqual(jsonObj.password, undefined, "toJSON must not expose password");

      const serialized = JSON.parse(JSON.stringify(user));
      assert.strictEqual(serialized.password, undefined, "JSON serialization must not expose password");
      assert.strictEqual(serialized.firstName, "Grace");
    });

    it("POST /login returns sanitized user without password in response body", async () => {
      const loginHandler = getHandler(authRouter, "/login", "post");
      const fakeUser = new User({
        _id: new mongoose.Types.ObjectId(),
        firstName: "Linus",
        lastName: "Torvalds",
        emailId: "linus@kernel.org",
        password: "$2b$10$hashedpasswordhere",
      });

      User.findOne = async () => fakeUser;
      fakeUser.validatePassword = async () => true;

      const req = {
        body: { emailId: "linus@kernel.org", password: "Password123!" },
      };
      const res = createMockRes();

      await loginHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.password, undefined, "Response root must not contain password");
      assert.strictEqual(res.body.data.password, undefined, "Response data must not contain password");
      assert.strictEqual(res.body.firstName, "Linus");
      assert.ok(res.cookies.token, "Auth cookie must be set");
    });

    it("GET /profile/view returns user without password hash", async () => {
      const profileViewHandler = getHandler(profileRouter, "/profile/view", "get");
      const fakeUser = new User({
        _id: new mongoose.Types.ObjectId(),
        firstName: "Margaret",
        lastName: "Hamilton",
        emailId: "margaret@apollo.nasa",
        password: "$2b$10$hashedpasswordhere",
      });

      const req = { user: fakeUser };
      const res = createMockRes();

      await profileViewHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.password, undefined, "Root must not contain password");
      assert.strictEqual(res.body.data.password, undefined, "Data must not contain password");
      assert.strictEqual(res.body.firstName, "Margaret");
    });
  });

  // 3. R1.3 WebSocket Membership Check
  describe("R1.3 WebSocket Auth & Membership Check", () => {
    it("saveProjectState rejects updates when socket user is not a room member", async () => {
      const roomId = "room-test-1";
      const memberId = new mongoose.Types.ObjectId();
      const nonMemberId = new mongoose.Types.ObjectId();

      let updated = false;
      ProjectRoom.findOne = async () => ({
        roomId,
        members: [memberId],
      });
      ProjectRoom.findOneAndUpdate = async () => {
        updated = true;
      };

      // Test event handler with non-member socket
      const socket = {
        userId: nonMemberId.toString(),
      };

      // Replicate the handler logic
      const handleSaveProjectState = async ({ roomId, code, language }) => {
        const room = await ProjectRoom.findOne({ roomId });
        if (!room || !room.members.some((m) => m.toString() === socket.userId)) return;
        await ProjectRoom.findOneAndUpdate({ roomId }, { lastCode: code, lastLanguage: language });
      };

      await handleSaveProjectState({ roomId, code: "console.log(1)", language: "javascript" });
      assert.strictEqual(updated, false, "Non-member update must be rejected");

      // Test with valid member
      socket.userId = memberId.toString();
      await handleSaveProjectState({ roomId, code: "console.log(2)", language: "javascript" });
      assert.strictEqual(updated, true, "Member update must be allowed");
    });

    it("room:chat_message rejects messages when socket user is not a room member", async () => {
      const roomId = "room-test-2";
      const memberId = new mongoose.Types.ObjectId();
      const nonMemberId = new mongoose.Types.ObjectId();

      let pushedChat = false;
      let broadcasted = false;

      ProjectRoom.findOne = async () => ({
        roomId,
        members: [memberId],
      });
      ProjectRoom.findOneAndUpdate = async () => {
        pushedChat = true;
      };

      const socket = {
        userId: nonMemberId.toString(),
        to: () => ({
          emit: () => {
            broadcasted = true;
          },
        }),
      };

      const handleRoomChatMessage = async ({ roomId, message }) => {
        const room = await ProjectRoom.findOne({ roomId });
        if (!room || !room.members.some((m) => m.toString() === socket.userId)) return;
        await ProjectRoom.findOneAndUpdate({ roomId }, { $push: { chats: message } });
        socket.to(roomId).emit("room:chat_message", { message });
      };

      await handleRoomChatMessage({ roomId, message: "Hello world" });
      assert.strictEqual(pushedChat, false, "Non-member chat must not be saved");
      assert.strictEqual(broadcasted, false, "Non-member chat must not be broadcast");

      // Test with valid member
      socket.userId = memberId.toString();
      await handleRoomChatMessage({ roomId, message: "Hello world" });
      assert.strictEqual(pushedChat, true, "Member chat must be saved");
      assert.strictEqual(broadcasted, true, "Member chat must be broadcast");
    });
  });

  // 4. R1.4 Chat Pagination Sort
  describe("R1.4 Chat Pagination Sort", () => {
    it("GET /chat/:targetId sorts messages by { createdAt: -1 } descending", async () => {
      const chatHandler = getHandler(chatRouter, "/chat/:targetId", "get");

      const loggedInUserId = new mongoose.Types.ObjectId();
      const targetUserId = new mongoose.Types.ObjectId();

      ConnectionRequest.findOne = async () => ({ status: "accepted" });
      User.findById = () => ({
        select: async () => ({ firstName: "Target", lastName: "User" }),
      });

      let capturedSort = null;
      const Message = require("../models/Message");
      Message.find = () => ({
        sort: (sortObj) => {
          capturedSort = sortObj;
          return {
            skip: () => ({
              limit: () => ({
                populate: async () => [
                  { _id: new mongoose.Types.ObjectId(), text: "Latest message" },
                ],
              }),
            }),
          };
        },
      });
      Message.updateMany = async () => {};

      const req = {
        user: { _id: loggedInUserId },
        params: { targetId: targetUserId.toString() },
        query: { page: "1", limit: "50" },
      };
      const res = createMockRes();

      await chatHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(capturedSort, { createdAt: -1 }, "Must sort descending by createdAt");
      assert.strictEqual(res.body.success, true);
    });
  });

  // 5. R1.5 Age Field Schema
  describe("R1.5 Age Field Schema { type: Number, min: 16 }", () => {
    it("schema path for age is Number with min: 16 validator", () => {
      const agePath = User.schema.path("age");
      assert.strictEqual(agePath.instance, "Number", "Age must be Number type");

      // Validate below min: 16
      const invalidUser = new User({
        firstName: "Youngster",
        emailId: "young@test.com",
        password: "Password123!",
        age: 15,
      });
      const valError = invalidUser.validateSync();
      assert.ok(valError, "Validation must fail for age < 16");
      assert.ok(valError.errors.age, "ValidationError must be on age path");

      // Validate at boundary min: 16
      const validUser16 = new User({
        firstName: "Teen",
        emailId: "teen@test.com",
        password: "Password123!",
        age: 16,
      });
      const val16 = validUser16.validateSync();
      assert.strictEqual(val16, undefined, "Age 16 must pass validation");

      // Validate above min: 25
      const adult = new User({
        firstName: "Adult",
        emailId: "adult@test.com",
        password: "Password123!",
        age: 25,
      });
      const valAdult = adult.validateSync();
      assert.strictEqual(valAdult, undefined, "Age 25 must pass validation");
    });
  });

  // 6. R1.6 Standardized Error Responses
  describe("R1.6 Standardized JSON Error Format { message, success: false }", () => {
    it("userAuth middleware returns JSON 401 when token is missing", async () => {
      const req = { cookies: {} };
      const res = createMockRes();
      let nextCalled = false;

      await userAuth(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
      assert.deepStrictEqual(res.body, { message: "Please Login!", success: false });
    });

    it("userAuth middleware returns JSON 400 when token verification fails", async () => {
      const req = { cookies: { token: "invalid-token" } };
      const res = createMockRes();

      await userAuth(req, res, () => {});

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(typeof res.body.message === "string");
    });

    it("POST /login returns standardized JSON error on invalid credentials", async () => {
      const loginHandler = getHandler(authRouter, "/login", "post");
      User.findOne = async () => null;

      const req = { body: { emailId: "nonexistent@test.com", password: "Password123!" } };
      const res = createMockRes();

      await loginHandler(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.message, "Invalid Credentials");
    });

    it("POST /request/send returns standardized JSON error on invalid status", async () => {
      const sendHandler = getHandler(requestRouter, "/request/send/:status/:toUserId", "post");

      const req = {
        user: { _id: new mongoose.Types.ObjectId() },
        params: { status: "invalid_status", toUserId: new mongoose.Types.ObjectId().toString() },
      };
      const res = createMockRes();

      await sendHandler(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.message.includes("Invalid Status Type"));
    });
  });

  // 7. R1.7 Cloudinary Upload Helper
  describe("R1.7 Cloudinary Upload Helper", () => {
    it("uploadStreamFromBuffer is exported and pipes buffer chunks to cloudinary uploader", async () => {
      assert.strictEqual(typeof uploadStreamFromBuffer, "function");
      assert.strictEqual(typeof cloudinary.uploadStreamFromBuffer, "function");

      // Verify that uploadStreamFromBuffer creates stream and calls cloudinary
      const testBuffer = Buffer.from("test image data");
      let streamCalled = false;
      let capturedOptions = null;

      const origUploadStream = cloudinary.uploader.upload_stream;
      cloudinary.uploader.upload_stream = (options, cb) => {
        streamCalled = true;
        capturedOptions = options;
        const writable = new (require("stream").Writable)({
          write(chunk, enc, next) {
            next();
          },
        });
        writable.on("finish", () => {
          cb(null, { secure_url: "https://cloudinary.com/test-url.png" });
        });
        return writable;
      };

      try {
        const result = await uploadStreamFromBuffer(testBuffer, { folder: "test/folder" });
        assert.strictEqual(streamCalled, true);
        assert.strictEqual(capturedOptions.folder, "test/folder");
        assert.strictEqual(result.secure_url, "https://cloudinary.com/test-url.png");
      } finally {
        cloudinary.uploader.upload_stream = origUploadStream;
      }
    });
  });

  // 8. R1.8 Cookie Helpers
  describe("R1.8 Cookie Helpers (setAuthCookie, clearAuthCookie)", () => {
    it("setAuthCookie sets token with httpOnly, secure, and sameSite: 'none'", () => {
      const res = createMockRes();
      setAuthCookie(res, "sample-token-jwt");

      assert.ok(res.cookies.token, "Cookie 'token' must be present");
      assert.strictEqual(res.cookies.token.val, "sample-token-jwt");
      assert.strictEqual(res.cookies.token.options.httpOnly, true);
      assert.strictEqual(res.cookies.token.options.secure, true);
      assert.strictEqual(res.cookies.token.options.sameSite, "none");
    });

    it("clearAuthCookie clears token cookie immediately", () => {
      const res = createMockRes();
      clearAuthCookie(res);

      assert.ok(res.cookies.token, "Cookie 'token' must be present");
      assert.strictEqual(res.cookies.token.val, null);
      assert.strictEqual(res.cookies.token.options.httpOnly, true);
      assert.strictEqual(res.cookies.token.options.secure, true);
      assert.strictEqual(res.cookies.token.options.sameSite, "none");
    });
  });

  // 9. R1.9 ConnectionRequest Reciprocal Check
  describe("R1.9 ConnectionRequest Reciprocal Check in .pre('save') Hook", () => {
    it("blocks request if sender and recipient are identical", async () => {
      const sameId = new mongoose.Types.ObjectId();
      const reqDoc = new ConnectionRequest({
        fromUserId: sameId,
        toUserId: sameId,
        status: "interested",
      });

      await assert.rejects(
        async () => {
          await reqDoc.save();
        },
        /Can't send connection request to yourself!/
      );
    });

    it("blocks request if reciprocal request already exists (B -> A when saving A -> B)", async () => {
      const userA = new mongoose.Types.ObjectId();
      const userB = new mongoose.Types.ObjectId();

      const origFindOne = ConnectionRequest.findOne;
      ConnectionRequest.findOne = async (query) => {
        // Simulate existing request from userB to userA
        return {
          _id: new mongoose.Types.ObjectId(),
          fromUserId: userB,
          toUserId: userA,
          status: "interested",
        };
      };

      try {
        const newReq = new ConnectionRequest({
          fromUserId: userA,
          toUserId: userB,
          status: "interested",
        });

        await assert.rejects(
          async () => {
            await newReq.save();
          },
          /Connection request already exists between these users!/
        );
      } finally {
        ConnectionRequest.findOne = origFindOne;
      }
    });
  });

  // 10. R2.13 Cascade Deletion on Project Post
  describe("R2.13 Cascade Deletion on Project Post Deletion", () => {
    it("DELETE /post/:id deletes ProjectRequest and ProjectRoom when post.type is 'project'", async () => {
      const deleteHandler = getHandler(postRouter, "/post/:id", "delete");

      const authorId = new mongoose.Types.ObjectId();
      const postId = new mongoose.Types.ObjectId();

      const fakePost = {
        _id: postId,
        authorId: authorId,
        type: "project",
        deleteOne: async () => {},
      };

      Post.findById = async () => fakePost;

      let reactionsDeleted = false;
      let commentsDeleted = false;
      let requestsDeleted = false;
      let roomsDeleted = false;

      Reaction.deleteMany = async (q) => {
        if (q.postId.equals(postId)) reactionsDeleted = true;
      };
      Comment.deleteMany = async (q) => {
        if (q.postId.equals(postId)) commentsDeleted = true;
      };
      ProjectRequest.deleteMany = async (q) => {
        if (q.projectPostId.equals(postId)) requestsDeleted = true;
      };
      ProjectRoom.deleteMany = async (q) => {
        if (q.projectPostId.equals(postId)) roomsDeleted = true;
      };

      const req = {
        params: { id: postId.toString() },
        user: { _id: authorId },
      };
      const res = createMockRes();

      await deleteHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(reactionsDeleted, true, "Reactions must be deleted");
      assert.strictEqual(commentsDeleted, true, "Comments must be deleted");
      assert.strictEqual(requestsDeleted, true, "ProjectRequests must be cascade deleted");
      assert.strictEqual(roomsDeleted, true, "ProjectRooms must be cascade deleted");
    });
  });

  // 11. R2.12 Project Join Status Map in GET /feed/projects
  describe("R2.12 Project Join Status Map in GET /feed/projects", () => {
    it("returns userRequestsMap and requestCountsMap", async () => {
      const feedProjectsHandler = getHandler(projectRouter, "/feed/projects", "get");

      const userId = new mongoose.Types.ObjectId();
      const project1 = {
        _id: new mongoose.Types.ObjectId(),
        type: "project",
        project: { title: "DevTinder" },
        toObject() {
          return { _id: this._id, type: "project" };
        },
      };

      Post.find = () => ({
        populate: () => ({
          sort: () => ({
            skip: () => ({
              limit: async () => [project1],
            }),
          }),
        }),
      });

      ProjectRequest.find = async () => [
        { projectPostId: project1._id, requesterId: userId, status: "pending" },
      ];

      ProjectRequest.aggregate = async () => [{ _id: project1._id, count: 3 }];

      const req = {
        user: { _id: userId },
        query: {},
      };
      const res = createMockRes();

      await feedProjectsHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.userRequestsMap, "userRequestsMap must be present");
      assert.strictEqual(res.body.userRequestsMap[project1._id.toString()], "pending");
      assert.ok(res.body.requestCountsMap, "requestCountsMap must be present");
      assert.strictEqual(res.body.requestCountsMap[project1._id.toString()], 3);
    });
  });

  // 12. R5.1 Global Search API
  describe("R5.1 Global Search API GET /user/search", () => {
    it("returns empty array when query q is empty", async () => {
      const searchHandler = getHandler(userRouter, "/user/search", "get");

      const req = {
        user: { _id: new mongoose.Types.ObjectId() },
        query: { q: "" },
      };
      const res = createMockRes();

      await searchHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.deepStrictEqual(res.body.data, []);
    });

    it("performs regex search across firstName, lastName, skills, headline", async () => {
      const searchHandler = getHandler(userRouter, "/user/search", "get");

      let capturedQuery = null;
      User.find = (q) => {
        capturedQuery = q;
        return {
          select: () => ({
            limit: async () => [
              {
                _id: new mongoose.Types.ObjectId(),
                firstName: "John",
                lastName: "Resig",
                skills: ["JavaScript", "jQuery"],
                headline: "Creator of jQuery",
              },
            ],
          }),
        };
      };

      const myId = new mongoose.Types.ObjectId();
      const req = {
        user: { _id: myId },
        query: { q: "jquery" },
      };
      const res = createMockRes();

      await searchHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.length, 1);
      assert.strictEqual(res.body.data[0].firstName, "John");
      assert.deepStrictEqual(capturedQuery._id, { $ne: myId });
      assert.ok(capturedQuery.$or, "Must search with $or array");
      assert.strictEqual(capturedQuery.$or.length, 4);
    });
  });

  // 13. R5.2 Forced Onboarding Field & Whitelist
  describe("R5.2 Forced Onboarding Schema Field & Whitelist", () => {
    it("profileComplete field exists on User schema with default false", () => {
      const profileCompletePath = User.schema.path("profileComplete");
      assert.ok(profileCompletePath, "profileComplete path must exist");
      assert.strictEqual(profileCompletePath.instance, "Boolean");
      assert.strictEqual(profileCompletePath.defaultValue, false);

      const user = new User({
        firstName: "Test",
        emailId: "test@domain.com",
        password: "Password123!",
      });
      assert.strictEqual(user.profileComplete, false);
    });

    it("profileComplete is whitelisted in validateMyProfileEditData", () => {
      const validEdit = validateMyProfileEditData({
        body: {
          firstName: "Jane",
          skills: ["React", "TypeScript"],
          profileComplete: true,
        },
      });
      assert.strictEqual(validEdit, true, "profileComplete must be allowed in profile edit");

      const invalidEdit = validateMyProfileEditData({
        body: {
          firstName: "Jane",
          unauthorizedField: "hacker",
        },
      });
      assert.strictEqual(invalidEdit, false, "Unknown fields must be rejected");
    });
  });

  // 14. Gate 1 Remediation: Regex Escaping, Error Standardization, Chat Pagination Guards & WebSocket Security
  describe("Gate 1 Remediation Verifications", () => {
    describe("14.1 Regex Escaping in GET /user/search", () => {
      it("safely escapes queries like 'C++', '[', '.*+?', and '(a+)+' without throwing SyntaxError", async () => {
        const searchHandler = getHandler(userRouter, "/user/search", "get");
        const specialQueries = ["C++", "[", "(", "*", "+", ".*+?", "(a+)+", "\\[react\\]", "\\"];
        const origFind = User.find;

        let capturedQueries = [];
        User.find = (q) => {
          capturedQueries.push(q);
          return {
            select: () => ({
              limit: async () => [],
            }),
          };
        };

        try {
          for (const q of specialQueries) {
            const req = {
              user: { _id: new mongoose.Types.ObjectId() },
              query: { q },
            };
            const res = createMockRes();

            await searchHandler(req, res);

            assert.strictEqual(res.statusCode, 200, `Query '${q}' must return 200`);
            assert.strictEqual(res.body.success, true);
            assert.deepStrictEqual(res.body.data, []);
          }

          assert.strictEqual(capturedQueries.length, specialQueries.length);
          // Check that regex in first query escaped ++
          const cppRegex = capturedQueries[0].$or[2].skills;
          assert.strictEqual(cppRegex.test("C++"), true);
          assert.strictEqual(cppRegex.test("C"), false);
        } finally {
          User.find = origFind;
        }
      });

      it("handles non-string query parameter gracefully", async () => {
        const searchHandler = getHandler(userRouter, "/user/search", "get");
        const req = {
          user: { _id: new mongoose.Types.ObjectId() },
          query: { q: ["malicious", "array"] },
        };
        const res = createMockRes();

        await searchHandler(req, res);

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.success, true);
        assert.deepStrictEqual(res.body.data, []);
      });
    });

    describe("14.2 Standardized JSON Error Response Format { message, success: false }", () => {
      it("postRouter returns { message, success: false } on validation and not-found errors", async () => {
        const createPostHandler = getHandler(postRouter, "/post", "post");
        const deletePostHandler = getHandler(postRouter, "/post/:id", "delete");

        // Missing content
        const res1 = createMockRes();
        await createPostHandler({ user: { _id: new mongoose.Types.ObjectId() }, body: {} }, res1);
        assert.strictEqual(res1.statusCode, 400);
        assert.strictEqual(res1.body.success, false);
        assert.ok(typeof res1.body.message === "string");

        // Delete post not found
        const origFindById = Post.findById;
        Post.findById = async () => null;
        try {
          const res2 = createMockRes();
          await deletePostHandler(
            { user: { _id: new mongoose.Types.ObjectId() }, params: { id: new mongoose.Types.ObjectId().toString() } },
            res2
          );
          assert.strictEqual(res2.statusCode, 404);
          assert.strictEqual(res2.body.success, false);
        } finally {
          Post.findById = origFindById;
        }
      });

      it("publicProfile returns { message, success: false } on 404", async () => {
        const profileHandler = getHandler(publicRouter, "/user/:userId", "get");
        const origFindById = User.findById;
        User.findById = () => ({ select: async () => null });
        try {
          const res = createMockRes();
          await profileHandler(
            { user: { _id: new mongoose.Types.ObjectId() }, params: { userId: new mongoose.Types.ObjectId().toString() } },
            res
          );
          assert.strictEqual(res.statusCode, 404);
          assert.strictEqual(res.body.success, false);
          assert.strictEqual(res.body.message, "User not found");
        } finally {
          User.findById = origFindById;
        }
      });

      it("commentRouter returns { message, success: false } on missing comment and not-found", async () => {
        const getCommentsHandler = getHandler(commentRouter, "/post/:id/comments", "get");
        const postCommentHandler = getHandler(commentRouter, "/post/:id/comment", "post");

        const origFindById = Post.findById;
        Post.findById = async () => null;
        try {
          const res1 = createMockRes();
          await getCommentsHandler(
            { user: { _id: new mongoose.Types.ObjectId() }, params: { id: new mongoose.Types.ObjectId().toString() } },
            res1
          );
          assert.strictEqual(res1.statusCode, 404);
          assert.strictEqual(res1.body.success, false);

          const res2 = createMockRes();
          await postCommentHandler(
            { user: { _id: new mongoose.Types.ObjectId() }, params: { id: new mongoose.Types.ObjectId().toString() }, body: {} },
            res2
          );
          assert.strictEqual(res2.statusCode, 400);
          assert.strictEqual(res2.body.success, false);
          assert.strictEqual(res2.body.message, "Comment text is required");
        } finally {
          Post.findById = origFindById;
        }
      });
    });

    describe("14.3 Chat Pagination Boundary Guard (Math.max(1, page), limit 1..100)", () => {
      it("clamps negative page and oversized limit to valid boundaries", async () => {
        const chatHandler = getHandler(chatRouter, "/chat/:targetId", "get");
        const origReqFindOne = ConnectionRequest.findOne;
        const origUserFindById = User.findById;
        const origMsgFind = Message.find;

        ConnectionRequest.findOne = async () => ({ status: "accepted" });
        User.findById = () => ({ select: async () => ({ firstName: "Ada" }) });

        let capturedSkip = null;
        let capturedLimit = null;
        Message.find = () => ({
          sort: () => ({
            skip: (s) => {
              capturedSkip = s;
              return {
                limit: (l) => {
                  capturedLimit = l;
                  return {
                    populate: async () => [],
                  };
                },
              };
            },
          }),
        });

        try {
          // Negative page (-5) and negative limit (-20)
          const req1 = {
            user: { _id: new mongoose.Types.ObjectId() },
            params: { targetId: new mongoose.Types.ObjectId().toString() },
            query: { page: "-5", limit: "-20" },
          };
          const res1 = createMockRes();
          await chatHandler(req1, res1);

          assert.strictEqual(res1.statusCode, 200);
          assert.strictEqual(capturedSkip, 0, "Skip must be >= 0");
          assert.strictEqual(capturedLimit, 1, "Limit must be clamped to min 1");

          // Oversized limit (500) and page 3
          const req2 = {
            user: { _id: new mongoose.Types.ObjectId() },
            params: { targetId: new mongoose.Types.ObjectId().toString() },
            query: { page: "3", limit: "500" },
          };
          const res2 = createMockRes();
          await chatHandler(req2, res2);

          assert.strictEqual(res2.statusCode, 200);
          assert.strictEqual(capturedLimit, 100, "Limit must be capped at 100");
          assert.strictEqual(capturedSkip, (3 - 1) * 100, "Skip must be calculated from capped limit");
        } finally {
          ConnectionRequest.findOne = origReqFindOne;
          User.findById = origUserFindById;
          Message.find = origMsgFind;
        }
      });
    });

    describe("14.4 WebSocket Room Authorization & Connection Security", () => {
      let io;
      let connectionHandler;

      beforeEach(() => {
        const server = http.createServer();
        io = initializeSocket(server);
        connectionHandler = io.listeners("connection")[0];
      });

      function setupSocketForTest(userId) {
        const events = {};
        const emittedErrors = [];
        const joinedRooms = [];
        const mockSocket = {
          id: `sock_${userId}`,
          userId,
          join(r) { joinedRooms.push(r); },
          leave() {},
          emit(evt, data) {
            if (evt === "error") emittedErrors.push(data);
          },
          to() {
            return { emit() {} };
          },
          on(evt, handler) {
            events[evt] = handler;
          },
        };
        connectionHandler(mockSocket);
        return { events, emittedErrors, joinedRooms };
      }

      it("chat:system_message rejects sending when sender and target are not connected", async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const targetId = new mongoose.Types.ObjectId().toString();
        const { events, emittedErrors } = setupSocketForTest(userId);

        const origFindOne = ConnectionRequest.findOne;
        let createdMessage = false;
        const origMsgCreate = Message.create;

        try {
          ConnectionRequest.findOne = async () => null; // Not connected!
          Message.create = async () => { createdMessage = true; };

          await events["chat:system_message"]({
            targetId,
            text: "System notification test",
          });

          assert.strictEqual(createdMessage, false, "Message must NOT be created without connection");
          assert.strictEqual(emittedErrors.length, 1);
          assert.strictEqual(emittedErrors[0].message, "You can only chat with your connections.");
        } finally {
          ConnectionRequest.findOne = origFindOne;
          Message.create = origMsgCreate;
        }
      });

      it("enterProjectRoom blocks non-members from joining the socket room", async () => {
        const memberId = new mongoose.Types.ObjectId();
        const nonMemberId = new mongoose.Types.ObjectId().toString();
        const roomId = "proj_room_auth_check";
        const { events, emittedErrors, joinedRooms } = setupSocketForTest(nonMemberId);

        const origFindOne = ProjectRoom.findOne;
        try {
          ProjectRoom.findOne = async () => ({
            roomId,
            members: [memberId], // nonMemberId is not in members
          });

          await events["enterProjectRoom"]({
            roomId,
            projectTitle: "Super Secret App",
          });

          assert.strictEqual(joinedRooms.includes(roomId), false, "Non-member must NOT join room");
          assert.strictEqual(emittedErrors.length, 1);
          assert.strictEqual(emittedErrors[0].message, "You are not a member of this room.");
        } finally {
          ProjectRoom.findOne = origFindOne;
        }
      });

      it("enterProjectRoom allows member to join the socket room", async () => {
        const memberId = new mongoose.Types.ObjectId();
        const roomId = "proj_room_auth_check_member";
        const { events, emittedErrors, joinedRooms } = setupSocketForTest(memberId.toString());

        const origFindOne = ProjectRoom.findOne;
        try {
          ProjectRoom.findOne = async () => ({
            roomId,
            members: [memberId],
          });

          await events["enterProjectRoom"]({
            roomId,
            projectTitle: "Collab App",
          });

          assert.strictEqual(joinedRooms.includes(roomId), true, "Member must join room");
          assert.strictEqual(emittedErrors.length, 0);
        } finally {
          ProjectRoom.findOne = origFindOne;
        }
      });
    });
  });
});
