let User = require('../models/user');
let Task = require('../models/task');
let api = require('../utils/api');
let parseTaskBody = require('../utils/validate').parseTaskBody;

let ApiError = api.ApiError;
let send = api.send;
let isValidId = api.isValidId;

let NOT_FOUND = 'Task not found.';

async function resolveAssignee(t, session) {
    if (!t.assignedUser) {
        let n = t.assignedUserName;

        if (n !== undefined && n !== '' && n !== 'unassigned') {
            throw new ApiError(400, 'assignedUserName was given but the task is not assigned to a user.');
        }

        t.assignedUser = '';
        t.assignedUserName = 'unassigned';
        return null;
    }

    let user = await User.findById(t.assignedUser).session(session);
    if (!user) 
        throw new ApiError(404, 'The user this task is assigned to does not exist.');

    if (t.assignedUserName === undefined || t.assignedUserName === '') {
        t.assignedUserName = user.name;
    } 
    else if (t.assignedUserName !== user.name) {
        throw new ApiError(400, 'assignedUserName does not match the name of the assigned user.');
    }
    return user;
}

async function syncUserList(user, task, session) {
    let update = task.completed
        ? { $pull: { pendingTasks: String(task._id) } }
        : { $addToSet: { pendingTasks: String(task._id) } };
    await User.updateOne({ _id: user._id }, update, { session: session });
}

module.exports = function (router) {
    let tasksRoute = router.route('/tasks');
    let tasksIdRoute = router.route('/tasks/:id');

    tasksRoute.get(async function (req, res) {
        try {
            let query = api.buildListQuery(Task, req, 100);
            let result = await query.exec();
            send(res, 200, 'OK', result);
        } catch (err) {
            api.handleError(res, err);
        }
    });

    tasksRoute.post(async function (req, res) {
        try {
            let input = parseTaskBody(req);
            let newTask = new Task(input);
            await api.assertValid(newTask);

            await Task.db.transaction(async function (session) {
                let user = await resolveAssignee(input, session);
                newTask.assignedUser = input.assignedUser;
                newTask.assignedUserName = input.assignedUserName;
                await newTask.save({ session: session });
                if (user) 
                    await syncUserList(user, newTask, session);
            });
            send(res, 201, 'Task created.', newTask);
        } catch (err) {
            api.handleError(res, err);
        }
    });

    tasksIdRoute.get(async function (req, res) {
        try {
            let taskId = req.params['id'];
            if (!isValidId(taskId)) 
                throw new ApiError(404, NOT_FOUND);

            let query = Task.findById(taskId);
            let select = api.parseSelect(req);
            if (select) query.select(select);

            let result = await query.exec();
            if (!result) 
                throw new ApiError(404, NOT_FOUND);

            send(res, 200, 'OK', result);
        } catch (err) {
            api.handleError(res, err);
        }
    });

    tasksIdRoute.put(async function (req, res) {
        try {
            let taskId = req.params['id'];
            if (!isValidId(taskId)) 
                throw new ApiError(404, NOT_FOUND);

            let saved;
            await Task.db.transaction(async function (session) {
                let task = await Task.findById(taskId).session(session);
                if (!task) 
                    throw new ApiError(404, NOT_FOUND);

                let input = parseTaskBody(req);
                await api.assertValid(new Task(input));
                let user = await resolveAssignee(input, session);
                let previousOwner = task.assignedUser;

                task.set(input);
                await task.save({ session: session });

                if (previousOwner && previousOwner !== task.assignedUser && isValidId(previousOwner)) {
                    await User.updateOne(
                        { _id: previousOwner },
                        { $pull: { pendingTasks: String(task._id) } },
                        { session: session }
                    );
                }
                if (user) 
                    await syncUserList(user, task, session);
                saved = task;
            });
            send(res, 200, 'Task updated.', saved);
        } catch (err) {
            api.handleError(res, err);
        }
    });

    tasksIdRoute.delete(async function (req, res) {
        try {
            let taskId = req.params['id'];
            if (!isValidId(taskId)) 
                throw new ApiError(404, NOT_FOUND);

            await Task.db.transaction(async function (session) {
                let task = await Task.findById(taskId).session(session);
                if (!task) 
                    throw new ApiError(404, NOT_FOUND);

                await task.deleteOne({ session: session });
                await User.updateMany(
                    { pendingTasks: String(task._id) },
                    { $pull: { pendingTasks: String(task._id) } },
                    { session: session }
                );
            });
            res.status(204).end();
        } catch (err) {
            api.handleError(res, err);
        }
    });

    return router;
};