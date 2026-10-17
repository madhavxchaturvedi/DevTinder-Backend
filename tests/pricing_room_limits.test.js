const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");

const projectRouter = require("../routes/projectRouter");
const ProjectRoom = require("../models/ProjectRoom");
const ProjectRequest = require("../models/ProjectRequest");
const Post = require("../models/Post");
const User = require("../models/User");
const Notification = require("../models/Notification");
const ConnectionRequestModel = require("../models/connectionRequest");

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

// Find route handlers directly from projectRouter stack
function getHandler(method, path) {
  for (const layer of projectRouter.stack) {
    if (layer.route && layer.route.methods[method.toLowerCase()]) {
      const match = Array.isArray(layer.route.path)
        ? layer.route.path.includes(path)
        : layer.route.path === path;
      if (match) {
        return layer.route.stack[layer.route.stack.length - 1].handle;
      }
    }
  }
  throw new Error(`Handler not found for ${method} ${path}`);
}

describe("Pricing & Free-Tier Engine: Backend Active Room Limits", () => {
  const freeUserId = new mongoose.Types.ObjectId();
  const proUserId = new mongoose.Types.ObjectId();
  const requesterUserId = new mongoose.Types.ObjectId();
  const requestId = new mongoose.Types.ObjectId();
  const postId = new mongoose.Types.ObjectId();

  const mockFreeUser = {
    _id: freeUserId,
    isPremium: false,
    firstName: "Free",
    lastName: "Dev",
  };

  const mockProUser = {
    _id: proUserId,
    isPremium: true,
    firstName: "Pro",
    lastName: "Dev",
  };

  beforeEach(() => {
    // Reset mocks
    Notification.create = async () => ({
      populate: async () => ({}),
    });
    ConnectionRequestModel.findOne = async () => null;
    ConnectionRequestModel.create = async () => ({ status: "accepted" });
    Post.findById = async () => ({
      _id: postId,
      authorId: freeUserId,
      project: { isOpen: true, title: "Test Project" },
      save: async () => {},
    });
  });

  describe("1. Direct Room Creation (POST /project/room)", () => {
    const createRoomHandler = getHandler("POST", "/project/room");

    it("allows a Free tier user with 0 active rooms to create a room", async () => {
      ProjectRoom.countDocuments = async () => 0;
      let createdData = null;
      ProjectRoom.create = async (data) => {
        createdData = data;
        return { ...data, _id: new mongoose.Types.ObjectId() };
      };

      const req = {
        user: mockFreeUser,
        body: { title: "First Room", template: "react" },
      };
      const res = createMockRes();

      await createRoomHandler(req, res);

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(createdData);
      assert.strictEqual(createdData.ownerId.toString(), freeUserId.toString());
    });

    it("rejects a Free tier user with 1 active room with 403 and standardized message", async () => {
      ProjectRoom.countDocuments = async () => 1;

      const req = {
        user: mockFreeUser,
        body: { title: "Second Room" },
      };
      const res = createMockRes();

      await createRoomHandler(req, res);

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(
        res.body.message,
        "Free tier is limited to 1 active room. Upgrade to Pro for unlimited rooms."
      );
    });

    it("allows a Pro tier user (isPremium === true) with 1+ active rooms to create another room", async () => {
      ProjectRoom.countDocuments = async () => 5;
      let created = false;
      ProjectRoom.create = async (data) => {
        created = true;
        return { ...data, _id: new mongoose.Types.ObjectId() };
      };

      const req = {
        user: mockProUser,
        body: { title: "Pro Unlimited Room" },
      };
      const res = createMockRes();

      await createRoomHandler(req, res);

      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(created, true);
    });
  });

  describe("2. Request Accept Handlers (POST /project/review/:requestId/:status)", () => {
    const reviewHandler = getHandler("POST", "/project/review/:requestId/:status");

    it("rejects Free owner with 1 active room when accepting a join request", async () => {
      ProjectRequest.findById = async () => ({
        _id: requestId,
        ownerId: freeUserId,
        requesterId: requesterUserId,
        projectPostId: postId,
        status: "pending",
        save: async () => {},
      });

      // Free user already has 1 active room
      ProjectRoom.countDocuments = async (query) => {
        if (query.$or && query.$or.some((o) => o.ownerId && o.ownerId.toString() === freeUserId.toString())) {
          return 1;
        }
        return 0;
      };

      const req = {
        user: mockFreeUser,
        params: { requestId: requestId.toString(), status: "accepted" },
        app: { get: () => null },
      };
      const res = createMockRes();

      await reviewHandler(req, res);

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(
        res.body.message,
        "Free tier is limited to 1 active room. Upgrade to Pro for unlimited rooms."
      );
    });

    it("rejects Free requester with 1 active room when owner attempts to accept", async () => {
      ProjectRequest.findById = async () => ({
        _id: requestId,
        ownerId: proUserId,
        requesterId: requesterUserId,
        projectPostId: postId,
        status: "pending",
        save: async () => {},
      });

      User.findById = async (id) => {
        if (id.toString() === requesterUserId.toString()) {
          return { _id: requesterUserId, isPremium: false };
        }
        return null;
      };

      ProjectRoom.countDocuments = async (query) => {
        // Requester has 1 active room
        if (query.$or && query.$or.some((o) => o.ownerId && o.ownerId.toString() === requesterUserId.toString())) {
          return 1;
        }
        return 0;
      };

      const req = {
        user: mockProUser, // Owner is pro
        params: { requestId: requestId.toString(), status: "accepted" },
        app: { get: () => null },
      };
      const res = createMockRes();

      await reviewHandler(req, res);

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(
        res.body.message,
        "Free tier is limited to 1 active room. Upgrade to Pro for unlimited rooms."
      );
    });

    it("allows Pro users to accept requests and form rooms without limit", async () => {
      ProjectRequest.findById = async () => ({
        _id: requestId,
        ownerId: proUserId,
        requesterId: requesterUserId,
        projectPostId: postId,
        status: "pending",
        save: async () => {},
      });

      User.findById = async () => ({ _id: requesterUserId, isPremium: true });
      ProjectRequest.find = async () => [];
      let roomCreated = false;
      ProjectRoom.create = async () => {
        roomCreated = true;
        return {};
      };

      const req = {
        user: mockProUser,
        params: { requestId: requestId.toString(), status: "accepted" },
        app: { get: () => null },
      };
      const res = createMockRes();

      await reviewHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(roomCreated, true);
    });

    it("allows rejecting requests regardless of active room count", async () => {
      ProjectRequest.findById = async () => ({
        _id: requestId,
        ownerId: freeUserId,
        requesterId: requesterUserId,
        projectPostId: postId,
        status: "pending",
        save: async () => {},
      });

      ProjectRoom.countDocuments = async () => 10; // Would block if accepted

      const req = {
        user: mockFreeUser,
        params: { requestId: requestId.toString(), status: "rejected" },
        app: { get: () => null },
      };
      const res = createMockRes();

      await reviewHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.message, "Request rejected.");
    });
  });

  describe("3. Active Room State Query Filters (completed / archived rooms do not block)", () => {
    it("queries status $nin ['completed', 'archived'] to ignore finished projects", async () => {
      const createRoomHandler = getHandler("POST", "/project/room");
      let capturedQuery = null;

      ProjectRoom.countDocuments = async (query) => {
        capturedQuery = query;
        return 0; // completed/archived rooms don't count
      };

      ProjectRoom.create = async (data) => ({ ...data });

      const req = {
        user: mockFreeUser,
        body: { title: "Next Project" },
      };
      const res = createMockRes();

      await createRoomHandler(req, res);

      assert.strictEqual(res.statusCode, 201);
      assert.ok(capturedQuery);
      assert.deepStrictEqual(capturedQuery.status, { $nin: ["completed", "archived"] });
    });
  });

  describe("4. Room Access Invariant (GET /project/room/:roomId)", () => {
    const getRoomHandler = getHandler("GET", "/project/room/:roomId");

    it("does not gate a Free user from accessing a room where they are an authorized member", async () => {
      ProjectRoom.findOne = () => ({
        populate: () => ({
          populate: () => ({
            populate: async () => ({
              roomId: "project_123",
              members: [{ _id: freeUserId }],
              title: "Active Room",
            }),
          }),
        }),
      });

      const req = {
        user: mockFreeUser,
        params: { roomId: "project_123" },
      };
      const res = createMockRes();

      await getRoomHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.roomId, "project_123");
    });

    it("rejects non-members with 403 when trying to access a room", async () => {
      const otherUserId = new mongoose.Types.ObjectId();
      ProjectRoom.findOne = () => ({
        populate: () => ({
          populate: () => ({
            populate: async () => ({
              roomId: "project_123",
              members: [{ _id: otherUserId }],
            }),
          }),
        }),
      });

      const req = {
        user: mockFreeUser,
        params: { roomId: "project_123" },
      };
      const res = createMockRes();

      await getRoomHandler(req, res);

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.message, "You are not a member of this room.");
    });
  });

  describe("5. Invited Collaborator Limit & Reverse Route Param Aliases", () => {
    it("rejects room creation if an invited collaborator is Free and has 1 active room", async () => {
      const createRoomHandler = getHandler("POST", "/project/room");
      const collabId = new mongoose.Types.ObjectId();

      User.findById = async (id) => {
        if (id.toString() === collabId.toString()) {
          return { _id: collabId, isPremium: false };
        }
        return null;
      };

      ProjectRoom.countDocuments = async (query) => {
        // Creator has 0, but collaborator has 1
        if (query.$or && query.$or.some((o) => o.ownerId && o.ownerId.toString() === collabId.toString())) {
          return 1;
        }
        return 0;
      };

      const req = {
        user: mockProUser, // Owner is Pro
        body: { title: "Team Room", members: [collabId] },
      };
      const res = createMockRes();

      await createRoomHandler(req, res);

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(
        res.body.message,
        "Free tier is limited to 1 active room. Upgrade to Pro for unlimited rooms."
      );
    });

    it("accepts reverse route param order (/project/review/:status/:requestId)", async () => {
      const reviewHandler = getHandler("POST", "/project/review/:requestId/:status");

      ProjectRequest.findById = async () => ({
        _id: requestId,
        ownerId: freeUserId,
        requesterId: requesterUserId,
        projectPostId: postId,
        status: "pending",
        save: async () => {},
      });

      // Free user already has 1 active room
      ProjectRoom.countDocuments = async () => 1;

      const req = {
        user: mockFreeUser,
        params: { status: requestId.toString(), requestId: "accepted" }, // reversed
        app: { get: () => null },
      };
      const res = createMockRes();

      await reviewHandler(req, res);

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(
        res.body.message,
        "Free tier is limited to 1 active room. Upgrade to Pro for unlimited rooms."
      );
    });
  });
});

