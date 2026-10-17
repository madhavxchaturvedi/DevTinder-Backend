const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Post = require("../models/Post");
const Comment = require("../models/Comment");
const Reaction = require("../models/Reaction");
const ProjectRoom = require("../models/ProjectRoom");
const ProjectRequest = require("../models/ProjectRequest");
const ConnectionRequestModel = require("../models/connectionRequest");

const authRouter = require("../routes/auth");
const postRouter = require("../routes/postRouter");
const initializeSocket = require("../utils/socket");
const { setAuthCookie, clearAuthCookie } = require("../routes/auth");

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

describe("Challenger M1-2 Empirical Verification: WebSocket Security, Cascade Deletion & JWT/Cookies", () => {
  const TEST_JWT_SECRET = "empirical-challenger-m1-2-super-secret-key-12345";

  beforeEach(() => {
    process.env.JWT_SECRET_KEY = TEST_JWT_SECRET;
  });

  // =========================================================================
  // 1. WebSocket Privilege Escalation & Auth Security
  // =========================================================================
  describe("1. WebSocket Privilege Escalation & Security Checks (Backend/utils/socket.js)", () => {
    let io;
    let authMiddleware;
    let connectionHandler;

    beforeEach(() => {
      const server = http.createServer();
      io = initializeSocket(server);
      authMiddleware = io.of("/")._fns[0];
      connectionHandler = io.listeners("connection")[0];
    });

    describe("1.1 Socket Handshake Authentication Middleware", () => {
      it("allows handshake when valid token is present in cookie signed with JWT_SECRET_KEY", (t, done) => {
        const userId = new mongoose.Types.ObjectId().toString();
        const validToken = jwt.sign({ _id: userId }, TEST_JWT_SECRET, { expiresIn: "1h" });

        const mockSocket = {
          handshake: {
            headers: {
              cookie: `token=${validToken}; other=test`,
            },
          },
        };

        authMiddleware(mockSocket, (err) => {
          assert.strictEqual(err, undefined, "Expected no authentication error");
          assert.strictEqual(mockSocket.userId, userId, "socket.userId must match token payload");
          done();
        });
      });

      it("rejects handshake when cookie header is completely absent", (t, done) => {
        const mockSocket = {
          handshake: {
            headers: {},
          },
        };

        authMiddleware(mockSocket, (err) => {
          assert.ok(err instanceof Error, "Expected error on missing cookie");
          assert.match(err.message, /No token found/);
          assert.strictEqual(mockSocket.userId, undefined);
          done();
        });
      });

      it("rejects handshake when token is missing from existing cookies", (t, done) => {
        const mockSocket = {
          handshake: {
            headers: {
              cookie: "session_id=abc; preferences=dark",
            },
          },
        };

        authMiddleware(mockSocket, (err) => {
          assert.ok(err instanceof Error, "Expected error on missing token cookie");
          assert.match(err.message, /No token found/);
          done();
        });
      });

      it("rejects handshake when token is signed with legacy hardcoded secret 'devtinder@2006'", (t, done) => {
        const userId = new mongoose.Types.ObjectId().toString();
        const legacyToken = jwt.sign({ _id: userId }, "devtinder@2006", { expiresIn: "1h" });

        const mockSocket = {
          handshake: {
            headers: {
              cookie: `token=${legacyToken}`,
            },
          },
        };

        authMiddleware(mockSocket, (err) => {
          assert.ok(err instanceof Error, "Expected error on legacy secret");
          assert.match(err.message, /invalid signature/);
          assert.strictEqual(mockSocket.userId, undefined);
          done();
        });
      });

      it("rejects handshake when token is malformed", (t, done) => {
        const mockSocket = {
          handshake: {
            headers: {
              cookie: "token=malformed.tampered.jwt",
            },
          },
        };

        authMiddleware(mockSocket, (err) => {
          assert.ok(err instanceof Error, "Expected error on malformed token");
          assert.match(err.message, /invalid token|jwt malformed/);
          done();
        });
      });

      it("rejects handshake when token is expired", (t, done) => {
        const userId = new mongoose.Types.ObjectId().toString();
        const expiredToken = jwt.sign({ _id: userId }, TEST_JWT_SECRET, { expiresIn: -10 });

        const mockSocket = {
          handshake: {
            headers: {
              cookie: `token=${expiredToken}`,
            },
          },
        };

        authMiddleware(mockSocket, (err) => {
          assert.ok(err instanceof Error, "Expected error on expired token");
          assert.match(err.message, /jwt expired/);
          done();
        });
      });
    });

    describe("1.2 saveProjectState Privilege Escalation Checks", () => {
      function setupSocketForTest(userId) {
        const events = {};
        const mockSocket = {
          id: `sock_${userId || "anon"}`,
          userId,
          join() {},
          leave() {},
          emit() {},
          to() {
            return { emit() {} };
          },
          on(evt, handler) {
            events[evt] = handler;
          },
        };
        connectionHandler(mockSocket);
        return { mockSocket, events };
      }

      it("allows saveProjectState when socket.userId is in room.members (ObjectId)", async () => {
        const memberId = new mongoose.Types.ObjectId();
        const roomId = "proj_room_member_test";
        const { events } = setupSocketForTest(memberId.toString());

        let updatedRoomId = null;
        let updatedPayload = null;

        const origFindOne = ProjectRoom.findOne;
        const origFindOneAndUpdate = ProjectRoom.findOneAndUpdate;
        try {
          ProjectRoom.findOne = async (q) => {
            if (q.roomId === roomId) {
              return { roomId, members: [memberId] };
            }
            return null;
          };
          ProjectRoom.findOneAndUpdate = async (q, update) => {
            updatedRoomId = q.roomId;
            updatedPayload = update;
            return { ...update, roomId };
          };

          await events["saveProjectState"]({
            roomId,
            code: "const x = 42;",
            language: "javascript",
          });

          assert.strictEqual(updatedRoomId, roomId, "ProjectRoom should have been updated");
          assert.deepStrictEqual(updatedPayload, {
            lastCode: "const x = 42;",
            lastLanguage: "javascript",
          });
        } finally {
          ProjectRoom.findOne = origFindOne;
          ProjectRoom.findOneAndUpdate = origFindOneAndUpdate;
        }
      });

      it("allows saveProjectState when socket.userId is in room.members as String", async () => {
        const memberIdStr = new mongoose.Types.ObjectId().toString();
        const roomId = "proj_room_string_member";
        const { events } = setupSocketForTest(memberIdStr);

        let updateCalled = false;
        const origFindOne = ProjectRoom.findOne;
        const origFindOneAndUpdate = ProjectRoom.findOneAndUpdate;
        try {
          ProjectRoom.findOne = async () => ({
            roomId,
            members: [memberIdStr],
          });
          ProjectRoom.findOneAndUpdate = async () => {
            updateCalled = true;
          };

          await events["saveProjectState"]({
            roomId,
            code: "console.log('string member allowed');",
            language: "typescript",
          });

          assert.strictEqual(updateCalled, true, "Update must succeed for string member match");
        } finally {
          ProjectRoom.findOne = origFindOne;
          ProjectRoom.findOneAndUpdate = origFindOneAndUpdate;
        }
      });

      it("PREVENTS saveProjectState when socket.userId is NOT in room.members (Privilege Escalation Blocked)", async () => {
        const memberId = new mongoose.Types.ObjectId();
        const attackerId = new mongoose.Types.ObjectId();
        const roomId = "proj_room_unauthorized_test";
        const { events } = setupSocketForTest(attackerId.toString());

        let updateCalled = false;
        const origFindOne = ProjectRoom.findOne;
        const origFindOneAndUpdate = ProjectRoom.findOneAndUpdate;
        try {
          ProjectRoom.findOne = async (q) => {
            if (q.roomId === roomId) {
              return {
                roomId,
                ownerId: memberId,
                members: [memberId], // Attacker is NOT here
              };
            }
            return null;
          };
          ProjectRoom.findOneAndUpdate = async () => {
            updateCalled = true;
          };

          await events["saveProjectState"]({
            roomId,
            code: "ATTACKER_INJECTED_CODE()",
            language: "python",
          });

          assert.strictEqual(
            updateCalled,
            false,
            "Attacker MUST NOT be allowed to update project state"
          );
        } finally {
          ProjectRoom.findOne = origFindOne;
          ProjectRoom.findOneAndUpdate = origFindOneAndUpdate;
        }
      });

      it("rejects saveProjectState when room does not exist in database", async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const { events } = setupSocketForTest(userId);

        let updateCalled = false;
        const origFindOne = ProjectRoom.findOne;
        const origFindOneAndUpdate = ProjectRoom.findOneAndUpdate;
        try {
          ProjectRoom.findOne = async () => null;
          ProjectRoom.findOneAndUpdate = async () => {
            updateCalled = true;
          };

          await events["saveProjectState"]({
            roomId: "non_existent_room",
            code: "some code",
            language: "javascript",
          });

          assert.strictEqual(updateCalled, false, "Update must not be called when room is null");
        } finally {
          ProjectRoom.findOne = origFindOne;
          ProjectRoom.findOneAndUpdate = origFindOneAndUpdate;
        }
      });

      it("safely handles undefined/null socket.userId without throwing or updating", async () => {
        const { events } = setupSocketForTest(undefined);
        const roomId = "room_with_members";
        let updateCalled = false;
        const origFindOne = ProjectRoom.findOne;
        const origFindOneAndUpdate = ProjectRoom.findOneAndUpdate;
        try {
          ProjectRoom.findOne = async () => ({
            roomId,
            members: [new mongoose.Types.ObjectId()],
          });
          ProjectRoom.findOneAndUpdate = async () => {
            updateCalled = true;
          };

          await events["saveProjectState"]({
            roomId,
            code: "test",
            language: "javascript",
          });

          assert.strictEqual(updateCalled, false, "Undefined socket userId must not update room");
        } finally {
          ProjectRoom.findOne = origFindOne;
          ProjectRoom.findOneAndUpdate = origFindOneAndUpdate;
        }
      });
    });

    describe("1.3 room:chat_message Privilege Escalation Checks", () => {
      function setupSocketForTest(userId) {
        const events = {};
        let broadcastedEvent = null;
        let broadcastedData = null;
        let broadcastTargetRoom = null;

        const mockSocket = {
          id: `sock_${userId || "anon"}`,
          userId,
          join() {},
          leave() {},
          emit() {},
          to(target) {
            broadcastTargetRoom = target;
            return {
              emit(evt, data) {
                broadcastedEvent = evt;
                broadcastedData = data;
              },
            };
          },
          on(evt, handler) {
            events[evt] = handler;
          },
        };
        connectionHandler(mockSocket);
        return {
          mockSocket,
          events,
          getBroadcast: () => ({ broadcastTargetRoom, broadcastedEvent, broadcastedData }),
        };
      }

      it("allows room:chat_message and broadcasts when socket.userId is in room.members", async () => {
        const memberId = new mongoose.Types.ObjectId();
        const roomId = "chat_room_member_test";
        const { events, getBroadcast } = setupSocketForTest(memberId.toString());

        let pushedMessage = null;
        const origFindOne = ProjectRoom.findOne;
        const origFindOneAndUpdate = ProjectRoom.findOneAndUpdate;
        try {
          ProjectRoom.findOne = async (q) => {
            if (q.roomId === roomId) return { roomId, members: [memberId] };
            return null;
          };
          ProjectRoom.findOneAndUpdate = async (q, update) => {
            pushedMessage = update;
          };

          const chatPayload = {
            text: "Hello collaborator!",
            senderId: memberId.toString(),
          };

          await events["room:chat_message"]({
            roomId,
            message: chatPayload,
          });

          assert.deepStrictEqual(pushedMessage, { $push: { chats: chatPayload } });
          const bc = getBroadcast();
          assert.strictEqual(bc.broadcastTargetRoom, roomId);
          assert.strictEqual(bc.broadcastedEvent, "room:chat_message");
          assert.deepStrictEqual(bc.broadcastedData, { message: chatPayload });
        } finally {
          ProjectRoom.findOne = origFindOne;
          ProjectRoom.findOneAndUpdate = origFindOneAndUpdate;
        }
      });

      it("PREVENTS room:chat_message when socket.userId is NOT in room.members (Chat Injection Blocked)", async () => {
        const memberId = new mongoose.Types.ObjectId();
        const attackerId = new mongoose.Types.ObjectId();
        const roomId = "chat_room_attacker_test";
        const { events, getBroadcast } = setupSocketForTest(attackerId.toString());

        let pushedMessage = null;
        const origFindOne = ProjectRoom.findOne;
        const origFindOneAndUpdate = ProjectRoom.findOneAndUpdate;
        try {
          ProjectRoom.findOne = async (q) => {
            if (q.roomId === roomId) return { roomId, members: [memberId] };
            return null;
          };
          ProjectRoom.findOneAndUpdate = async () => {
            pushedMessage = true;
          };

          await events["room:chat_message"]({
            roomId,
            message: { text: "SPAM ATTACK INJECTED" },
          });

          assert.strictEqual(pushedMessage, null, "Attacker message must not be pushed to DB");
          const bc = getBroadcast();
          assert.strictEqual(bc.broadcastedEvent, null, "Attacker message must not be broadcast");
        } finally {
          ProjectRoom.findOne = origFindOne;
          ProjectRoom.findOneAndUpdate = origFindOneAndUpdate;
        }
      });

      it("rejects room:chat_message when room does not exist", async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const { events, getBroadcast } = setupSocketForTest(userId);

        let pushed = false;
        const origFindOne = ProjectRoom.findOne;
        const origFindOneAndUpdate = ProjectRoom.findOneAndUpdate;
        try {
          ProjectRoom.findOne = async () => null;
          ProjectRoom.findOneAndUpdate = async () => {
            pushed = true;
          };

          await events["room:chat_message"]({
            roomId: "ghost_room",
            message: { text: "hello?" },
          });

          assert.strictEqual(pushed, false);
          assert.strictEqual(getBroadcast().broadcastedEvent, null);
        } finally {
          ProjectRoom.findOne = origFindOne;
          ProjectRoom.findOneAndUpdate = origFindOneAndUpdate;
        }
      });
    });

    describe("1.4 Additional Member Guards in socket.js (saveProjectFiles, room:tasks_update)", () => {
      function setupSocketForTest(userId) {
        const events = {};
        const mockSocket = {
          id: `sock_${userId}`,
          userId,
          join() {},
          leave() {},
          emit() {},
          to() {
            return { emit() {} };
          },
          on(evt, handler) {
            events[evt] = handler;
          },
        };
        connectionHandler(mockSocket);
        return { events };
      }

      it("saveProjectFiles blocks non-member from overwriting files", async () => {
        const memberId = new mongoose.Types.ObjectId();
        const attackerId = new mongoose.Types.ObjectId();
        const roomId = "files_room_test";
        const { events } = setupSocketForTest(attackerId.toString());

        let filesUpdated = false;
        const origFindOne = ProjectRoom.findOne;
        const origFindOneAndUpdate = ProjectRoom.findOneAndUpdate;
        try {
          ProjectRoom.findOne = async () => ({ roomId, members: [memberId] });
          ProjectRoom.findOneAndUpdate = async () => {
            filesUpdated = true;
          };

          await events["saveProjectFiles"]({
            roomId,
            files: { "/App.js": { code: "MALICIOUS OVERWRITE" } },
          });

          assert.strictEqual(filesUpdated, false, "Non-member must be blocked from updating files");
        } finally {
          ProjectRoom.findOne = origFindOne;
          ProjectRoom.findOneAndUpdate = origFindOneAndUpdate;
        }
      });

      it("room:tasks_update blocks non-member from updating tasks", async () => {
        const memberId = new mongoose.Types.ObjectId();
        const attackerId = new mongoose.Types.ObjectId();
        const roomId = "tasks_room_test";
        const { events } = setupSocketForTest(attackerId.toString());

        let tasksUpdated = false;
        const origFindOne = ProjectRoom.findOne;
        const origFindOneAndUpdate = ProjectRoom.findOneAndUpdate;
        try {
          ProjectRoom.findOne = async () => ({ roomId, members: [memberId] });
          ProjectRoom.findOneAndUpdate = async () => {
            tasksUpdated = true;
          };

          await events["room:tasks_update"]({
            roomId,
            tasks: [{ title: "Malicious Task", completed: true }],
          });

          assert.strictEqual(tasksUpdated, false, "Non-member must be blocked from updating tasks");
        } finally {
          ProjectRoom.findOne = origFindOne;
          ProjectRoom.findOneAndUpdate = origFindOneAndUpdate;
        }
      });
    });
  });

  // =========================================================================
  // 2. Cascade Deletion on Project Post Deletion
  // =========================================================================
  describe("2. Cascade Deletion on Project Post Deletion (DELETE /post/:id)", () => {
    const deleteHandler = getHandler(postRouter, "/post/:id", "delete");

    it("cleanly deletes Post, Comments, Reactions, ProjectRequests, and ProjectRoom when post.type === 'project'", async () => {
      const authorId = new mongoose.Types.ObjectId();
      const projectPostId = new mongoose.Types.ObjectId();

      let postDeleted = false;
      const reactionsDeletedFor = [];
      const commentsDeletedFor = [];
      const projectRequestsDeletedFor = [];
      const projectRoomsDeletedFor = [];

      // Mock database state tracking
      const mockPost = {
        _id: projectPostId,
        authorId,
        type: "project",
        deleteOne: async () => {
          postDeleted = true;
        },
      };

      const origPostFindById = Post.findById;
      const origReactionDeleteMany = Reaction.deleteMany;
      const origCommentDeleteMany = Comment.deleteMany;
      const origProjReqDeleteMany = ProjectRequest.deleteMany;
      const origProjRoomDeleteMany = ProjectRoom.deleteMany;

      try {
        Post.findById = async (id) => {
          if (id.toString() === projectPostId.toString()) return mockPost;
          return null;
        };

        Reaction.deleteMany = async (query) => {
          reactionsDeletedFor.push(query.postId.toString());
        };

        Comment.deleteMany = async (query) => {
          commentsDeletedFor.push(query.postId.toString());
        };

        ProjectRequest.deleteMany = async (query) => {
          projectRequestsDeletedFor.push(query.projectPostId.toString());
        };

        ProjectRoom.deleteMany = async (query) => {
          projectRoomsDeletedFor.push(query.projectPostId.toString());
        };

        const req = {
          params: { id: projectPostId.toString() },
          user: { _id: authorId },
        };
        const res = createMockRes();

        await deleteHandler(req, res);

        assert.strictEqual(res.statusCode, 200, "Should respond with 200 OK");
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.message, "Post deleted successfully");
        assert.strictEqual(res.body.data.toString(), projectPostId.toString());

        // Assert all deletions were executed with matching IDs
        assert.strictEqual(postDeleted, true, "Post document deleteOne must be called");
        assert.deepStrictEqual(reactionsDeletedFor, [projectPostId.toString()], "Reactions must be deleted");
        assert.deepStrictEqual(commentsDeletedFor, [projectPostId.toString()], "Comments must be deleted");
        assert.deepStrictEqual(
          projectRequestsDeletedFor,
          [projectPostId.toString()],
          "ProjectRequests must be cascade deleted"
        );
        assert.deepStrictEqual(
          projectRoomsDeletedFor,
          [projectPostId.toString()],
          "ProjectRooms must be cascade deleted"
        );
      } finally {
        Post.findById = origPostFindById;
        Reaction.deleteMany = origReactionDeleteMany;
        Comment.deleteMany = origCommentDeleteMany;
        ProjectRequest.deleteMany = origProjReqDeleteMany;
        ProjectRoom.deleteMany = origProjRoomDeleteMany;
      }
    });

    it("does NOT delete ProjectRequests or ProjectRooms when deleted post is NOT of type 'project'", async () => {
      const authorId = new mongoose.Types.ObjectId();
      const snippetPostId = new mongoose.Types.ObjectId();

      let postDeleted = false;
      let projectRequestsDeleted = false;
      let projectRoomsDeleted = false;

      const mockSnippetPost = {
        _id: snippetPostId,
        authorId,
        type: "snippet",
        deleteOne: async () => {
          postDeleted = true;
        },
      };

      const origPostFindById = Post.findById;
      const origReactionDeleteMany = Reaction.deleteMany;
      const origCommentDeleteMany = Comment.deleteMany;
      const origProjReqDeleteMany = ProjectRequest.deleteMany;
      const origProjRoomDeleteMany = ProjectRoom.deleteMany;

      try {
        Post.findById = async () => mockSnippetPost;
        Reaction.deleteMany = async () => {};
        Comment.deleteMany = async () => {};
        ProjectRequest.deleteMany = async () => {
          projectRequestsDeleted = true;
        };
        ProjectRoom.deleteMany = async () => {
          projectRoomsDeleted = true;
        };

        const req = {
          params: { id: snippetPostId.toString() },
          user: { _id: authorId },
        };
        const res = createMockRes();

        await deleteHandler(req, res);

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(postDeleted, true, "Snippet post should be deleted");
        assert.strictEqual(
          projectRequestsDeleted,
          false,
          "ProjectRequests must NOT be touched for snippet post"
        );
        assert.strictEqual(
          projectRoomsDeleted,
          false,
          "ProjectRooms must NOT be touched for snippet post"
        );
      } finally {
        Post.findById = origPostFindById;
        Reaction.deleteMany = origReactionDeleteMany;
        Comment.deleteMany = origCommentDeleteMany;
        ProjectRequest.deleteMany = origProjReqDeleteMany;
        ProjectRoom.deleteMany = origProjRoomDeleteMany;
      }
    });

    it("blocks unauthorized user from deleting someone else's post (403 Forbidden) and prevents cascade", async () => {
      const authorId = new mongoose.Types.ObjectId();
      const attackerId = new mongoose.Types.ObjectId();
      const postId = new mongoose.Types.ObjectId();

      let postDeleted = false;
      let reactionsDeleted = false;
      let requestsDeleted = false;
      let roomsDeleted = false;

      const mockPost = {
        _id: postId,
        authorId, // belongs to authorId
        type: "project",
        deleteOne: async () => {
          postDeleted = true;
        },
      };

      const origPostFindById = Post.findById;
      const origReactionDeleteMany = Reaction.deleteMany;
      const origProjReqDeleteMany = ProjectRequest.deleteMany;
      const origProjRoomDeleteMany = ProjectRoom.deleteMany;

      try {
        Post.findById = async () => mockPost;
        Reaction.deleteMany = async () => {
          reactionsDeleted = true;
        };
        ProjectRequest.deleteMany = async () => {
          requestsDeleted = true;
        };
        ProjectRoom.deleteMany = async () => {
          roomsDeleted = true;
        };

        const req = {
          params: { id: postId.toString() },
          user: { _id: attackerId }, // Different user
        };
        const res = createMockRes();

        await deleteHandler(req, res);

        assert.strictEqual(res.statusCode, 403, "Must return 403 Forbidden");
        assert.strictEqual(res.body.message, "You can only delete your own posts");
        assert.strictEqual(postDeleted, false, "Post must NOT be deleted");
        assert.strictEqual(reactionsDeleted, false, "Reactions must NOT be deleted");
        assert.strictEqual(requestsDeleted, false, "ProjectRequests must NOT be cascade deleted");
        assert.strictEqual(roomsDeleted, false, "ProjectRooms must NOT be cascade deleted");
      } finally {
        Post.findById = origPostFindById;
        Reaction.deleteMany = origReactionDeleteMany;
        ProjectRequest.deleteMany = origProjReqDeleteMany;
        ProjectRoom.deleteMany = origProjRoomDeleteMany;
      }
    });

    it("returns 404 Not Found when post does not exist", async () => {
      const origPostFindById = Post.findById;
      try {
        Post.findById = async () => null;

        const req = {
          params: { id: new mongoose.Types.ObjectId().toString() },
          user: { _id: new mongoose.Types.ObjectId() },
        };
        const res = createMockRes();

        await deleteHandler(req, res);

        assert.strictEqual(res.statusCode, 404);
        assert.strictEqual(res.body.message, "Post not found");
      } finally {
        Post.findById = origPostFindById;
      }
    });

    it("handles database exceptions gracefully and returns 500 JSON error", async () => {
      const authorId = new mongoose.Types.ObjectId();
      const postId = new mongoose.Types.ObjectId();

      const origPostFindById = Post.findById;
      try {
        Post.findById = async () => {
          throw new Error("Simulated Database I/O Failure");
        };

        const req = {
          params: { id: postId.toString() },
          user: { _id: authorId },
        };
        const res = createMockRes();

        await deleteHandler(req, res);

        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(res.body.success, false);
        assert.match(res.body.message, /Simulated Database I\/O Failure/);
      } finally {
        Post.findById = origPostFindById;
      }
    });
  });

  // =========================================================================
  // 3. Cookie & JWT Security Verification
  // =========================================================================
  describe("3. Cookie & JWT Security Verification", () => {
    describe("3.1 User.getJWT() token generation & signature verification", () => {
      it("signs token using process.env.JWT_SECRET_KEY with 14d expiration", async () => {
        const userId = new mongoose.Types.ObjectId();
        const user = new User({
          _id: userId,
          firstName: "Linus",
          lastName: "Torvalds",
          emailId: "linus@kernel.org",
          password: "SuperSecurePassword123!",
        });

        const token = await user.getJWT();
        assert.ok(typeof token === "string" && token.length > 20, "JWT must be a non-empty string");

        // Verify with current secret key
        const decoded = jwt.verify(token, TEST_JWT_SECRET);
        assert.strictEqual(decoded._id, userId.toString(), "Token payload _id must match user._id");

        // Expiration check: should be ~14 days (14 * 86400 = 1209600 seconds)
        const expectedExp = Math.floor(Date.now() / 1000) + 14 * 86400;
        assert.ok(
          Math.abs(decoded.exp - expectedExp) < 10,
          "Token expiration must be set to 14 days"
        );
      });

      it("rejects token verification when signed with hardcoded legacy secret 'devtinder@2006'", async () => {
        const user = new User({
          _id: new mongoose.Types.ObjectId(),
          firstName: "Alan",
          lastName: "Turing",
          emailId: "alan@enigma.ac.uk",
          password: "SecurePassword123!",
        });

        const token = await user.getJWT();

        // Must fail with old hardcoded secret
        assert.throws(
          () => {
            jwt.verify(token, "devtinder@2006");
          },
          /invalid signature/,
          "Token verification using old secret 'devtinder@2006' must fail"
        );
      });

      it("invalidates all previously issued tokens when JWT_SECRET_KEY is rotated", async () => {
        const user = new User({
          _id: new mongoose.Types.ObjectId(),
          firstName: "Ken",
          lastName: "Thompson",
          emailId: "ken@bell-labs.com",
          password: "SecurePassword123!",
        });

        const token = await user.getJWT();
        assert.ok(jwt.verify(token, TEST_JWT_SECRET));

        // Rotate secret
        const rotatedSecret = "new-rotated-secret-key-99999";
        assert.throws(
          () => {
            jwt.verify(token, rotatedSecret);
          },
          /invalid signature/,
          "Token verification must fail after secret rotation"
        );
      });
    });

    describe("3.2 Cookie Helper Security Attributes (setAuthCookie, clearAuthCookie)", () => {
      it("setAuthCookie sets httpOnly: true, secure: true, and sameSite: 'none'", () => {
        const res = createMockRes();
        const testToken = "jwt.header.payload.signature";

        setAuthCookie(res, testToken);

        assert.ok(res.cookies.token, "Cookie 'token' must be set");
        assert.strictEqual(res.cookies.token.val, testToken);

        const opts = res.cookies.token.options;
        assert.strictEqual(opts.httpOnly, true, "httpOnly must be true to prevent XSS theft");
        assert.strictEqual(opts.secure, true, "secure must be true to require HTTPS");
        assert.strictEqual(opts.sameSite, "none", "sameSite must be 'none' for cross-site cookie");
        assert.ok(opts.expires instanceof Date, "expires must be a Date object");
        assert.ok(opts.expires > new Date(), "expires must be in the future (8 hours)");
      });

      it("clearAuthCookie clears token with expires Date(0), httpOnly: true, secure: true", () => {
        const res = createMockRes();

        clearAuthCookie(res);

        assert.ok(res.cookies.token, "Cookie 'token' must be cleared");
        assert.strictEqual(res.cookies.token.val, null, "Cookie value should be null");

        const opts = res.cookies.token.options;
        assert.strictEqual(opts.httpOnly, true, "clearAuthCookie must keep httpOnly: true");
        assert.strictEqual(opts.secure, true, "clearAuthCookie must keep secure: true");
        assert.strictEqual(opts.sameSite, "none", "clearAuthCookie must keep sameSite: 'none'");
        assert.strictEqual(opts.expires.getTime(), 0, "expires must be epoch 0");
      });
    });

    describe("3.3 Authentication Endpoints Cookie Compliance", () => {
      it("POST /login sets secure cookie and strips password hash", async () => {
        const loginHandler = getHandler(authRouter, "/login", "post");
        const userId = new mongoose.Types.ObjectId();

        const fakeUser = new User({
          _id: userId,
          firstName: "Ada",
          lastName: "Lovelace",
          emailId: "ada@computing.org",
          password: "$2b$10$hashedpasswordhere",
        });

        const origFindOne = User.findOne;
        try {
          User.findOne = async () => fakeUser;
          fakeUser.validatePassword = async () => true;

          const req = {
            body: { emailId: "ada@computing.org", password: "Password123!" },
          };
          const res = createMockRes();

          await loginHandler(req, res);

          assert.strictEqual(res.statusCode, 200);
          assert.strictEqual(res.body.success, true);
          assert.strictEqual(res.body.password, undefined, "Root response must omit password");
          assert.strictEqual(res.body.data.password, undefined, "data payload must omit password");

          // Verify cookie
          assert.ok(res.cookies.token, "token cookie must be present");
          assert.strictEqual(res.cookies.token.options.httpOnly, true);
          assert.strictEqual(res.cookies.token.options.secure, true);
          assert.strictEqual(res.cookies.token.options.sameSite, "none");
        } finally {
          User.findOne = origFindOne;
        }
      });

      it("POST /logout clears cookie with secure flags", async () => {
        const logoutHandler = getHandler(authRouter, "/logout", "post");
        const req = {};
        const res = createMockRes();

        await logoutHandler(req, res);

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.message, "LOGOUT Successfully!!");

        assert.ok(res.cookies.token, "Cookie clear must be executed");
        assert.strictEqual(res.cookies.token.val, null);
        assert.strictEqual(res.cookies.token.options.httpOnly, true);
        assert.strictEqual(res.cookies.token.options.secure, true);
      });
    });
  });
});
