let User = require('../models/user');
let Task = require('../models/task');
let api = require('../utils/api');
let parseUserBody = require('../utils/validate').parseUserBody;

let ApiError = api.ApiError;
let send = api.send;
let isValidId = api.isValidId;

let NOT_FOUND = 'User not found.';
let UNASSIGN = { assignedUser: '', assignedUserName: 'unassigned' };

async function assertEmailFree(email, exceptId, session) {
    let filter = { email: email };

    if (exceptId) 
        filter._id = { $ne: exceptId };

    let clash = await User.findOne(filter).collation({ locale: 'en', strength: 2 }).session(session);
    if (clash) 
        throw new ApiError(400, 'A user with that email already exists.');
}

async function loadPendingTasks(ids, session) {
    if (ids.length === 0) 
        return [];

    let tasks = await Task.find({ _id: { $in: ids } }).session(session);

    if (tasks.length !== ids.length) 
        throw new ApiError(404, 'One or more tasks in pendingTasks do not exist.');

    if (tasks.some(function (t) { return t.completed; })) {
        throw new ApiError(400, 'A completed task cannot be in pendingTasks.');
    }

    return tasks;
}

async function syncTasksToUser(user, tasks, session) {
    let userId = String(user._id);
    let ids = tasks.map(function (t) { return String(t._id); });

    let previousOwners = new Set();
    tasks.forEach(function (t) {
        if (t.assignedUser && t.assignedUser !== userId && isValidId(t.assignedUser)) {
            previousOwners.add(t.assignedUser);
        }
    });
    if (previousOwners.size > 0) {
        await User.updateMany(
            { _id: { $in: Array.from(previousOwners) } },
            { $pull: { pendingTasks: { $in: ids } } },
            { session: session }
        );
    }

    await Task.updateMany(
        { assignedUser: userId, completed: false, _id: { $nin: ids } },
        { $set: UNASSIGN },
        { session: session }
    );

    if (ids.length > 0) {
        await Task.updateMany(
            { _id: { $in: ids } },
            { $set: { assignedUser: userId, assignedUserName: user.name } },
            { session: session }
        );
    }

    await Task.updateMany(
        { assignedUser: userId, assignedUserName: { $ne: user.name } },
        { $set: { assignedUserName: user.name } },
        { session: session }
    );
}

module.exports = function (router) {

    let usersRoute = router.route('/users');
    let usersIdRoute = router.route('/users/:id');

    usersRoute.get(async function (req, res) {
        try {
            let query = api.buildListQuery(User, req, 0);
            let result = await query.exec();
            send(res, 200, 'OK', result);
        } catch (err) {
            api.handleError(res, err);
        }
    });

    usersRoute.post(async function (req, res) {
        try {
            let input = parseUserBody(req);
            let newUser = new User({ name: input.name, email: input.email, pendingTasks: input.pendingTasks });
            await api.assertValid(newUser);

            await User.db.transaction(async function (session) {
                await assertEmailFree(input.email, null, session);
                let tasks = await loadPendingTasks(input.pendingTasks, session);
                await newUser.save({ session: session });
                await syncTasksToUser(newUser, tasks, session);
            });
            send(res, 201, 'User created.', newUser);
        } catch (err) {
            api.handleError(res, err);
        }
    });

    usersIdRoute.get(async function (req, res) {
        try {
            let userId = req.params['id'];
            if (!isValidId(userId)) 
                throw new ApiError(404, NOT_FOUND);

            let query = User.findById(userId);
            let select = api.parseSelect(req);
            if (select) 
                query.select(select);

            let result = await query.exec();
            if (!result) 
                throw new ApiError(404, NOT_FOUND);

            send(res, 200, 'OK', result);
        } catch (err) {
            api.handleError(res, err);
        }
    });

    usersIdRoute.put(async function (req, res) {
        try {
            let userId = req.params['id'];
            if (!isValidId(userId)) 
                throw new ApiError(404, NOT_FOUND);

            let saved;
            await User.db.transaction(async function (session) {
                let user = await User.findById(userId).session(session);
                if (!user) 
                    throw new ApiError(404, NOT_FOUND);

                let input = parseUserBody(req);
                await api.assertValid(new User({ name: input.name, email: input.email, pendingTasks: input.pendingTasks }));
                await assertEmailFree(input.email, user._id, session);
                let tasks = await loadPendingTasks(input.pendingTasks, session);

                user.name = input.name;
                user.email = input.email;
                user.pendingTasks = input.pendingTasks;
                await user.save({ session: session });
                await syncTasksToUser(user, tasks, session);
                saved = user;
            });
            send(res, 200, 'User updated.', saved);
        } catch (err) {
            api.handleError(res, err);
        }
    });

    usersIdRoute.delete(async function (req, res) {
        try {
            let userId = req.params['id'];
            if (!isValidId(userId)) 
                throw new ApiError(404, NOT_FOUND);

            let deleted;
            await User.db.transaction(async function (session) {
                let user = await User.findById(userId).session(session);
                if (!user) 
                    throw new ApiError(404, NOT_FOUND);

                await Task.updateMany({ assignedUser: String(user._id) }, { $set: UNASSIGN }, { session: session });
                await user.deleteOne({ session: session });
                deleted = user;
            });
            send(res, 200, 'User deleted.', deleted);
        } catch (err) {
            api.handleError(res, err);
        }
    });

    return router;
};