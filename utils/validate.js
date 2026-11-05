const { ApiError, isValidId } = require('./api');

const bodyOf = (req) =>
    req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};

const isForm = (req) => Boolean(req.is('urlencoded'));

const isBlank = (v) => typeof v !== 'string' || v.trim() === '';

function parseDate(value) {
    let d;
    if (typeof value === 'number') {
        d = new Date(value);
    } 
    else if (typeof value === 'string' && value.trim() !== '') {
        const s = value.trim();
        d = /^-?\d+$/.test(s) ? new Date(Number(s)) : new Date(s); 
    } 
    else {
        return null;
    }

    return Number.isNaN(d.getTime()) ? null : d;
}

function parsePendingTasks(value, form) {
    if (value === undefined) return [];
    let list = value;
    if (form && typeof value === 'string') list = value === '' ? [] : [value];
    if (!Array.isArray(list)) throw new ApiError(400, 'pendingTasks must be a list of task ids.');
    for (const id of list) {
        if (!isValidId(id)) throw new ApiError(400, 'pendingTasks contains an id that is not a valid task id.');
    }
    return [...new Set(list)]; 
}

function parseUserBody(req) {
    const body = bodyOf(req);
    if (isBlank(body.name)) 
        throw new ApiError(400, 'A user must have a name.');

    if (isBlank(body.email)) 
        throw new ApiError(400, 'A user must have an email.');

    return {
        name: body.name,
        email: body.email,
        pendingTasks: parsePendingTasks(body.pendingTasks, isForm(req))
    };
}

function parseTaskBody(req) {
    const body = bodyOf(req);
    const form = isForm(req);

    if (isBlank(body.name)) 
        throw new ApiError(400, 'A task must have a name.');

    const deadline = parseDate(body.deadline);
    if (!deadline) 
        throw new ApiError(400, 'A task must have a valid deadline.');

    let description = '';
    if (body.description !== undefined) {
        if (typeof body.description !== 'string') 
            throw new ApiError(400, 'description must be text.');

        description = body.description;
    }

    let completed = false;
    if (body.completed !== undefined) {
        if (typeof body.completed === 'boolean') 
            completed = body.completed;
        else if (form && (body.completed === 'true' || body.completed === 'false')) 
            completed = body.completed === 'true';
        else 
            throw new ApiError(400, 'completed must be true or false.');
    }

    let assignedUser = '';
    if (body.assignedUser !== undefined) {
        if (typeof body.assignedUser !== 'string') 
            throw new ApiError(400, 'assignedUser must be a user id.');
        if (body.assignedUser !== '' && !isValidId(body.assignedUser)) {
            throw new ApiError(400, 'assignedUser is not a valid user id.');
        }
        assignedUser = body.assignedUser;
    }

    let assignedUserName; 
    if (body.assignedUserName !== undefined) {
        if (typeof body.assignedUserName !== 'string') 
            throw new ApiError(400, 'assignedUserName must be text.');
        
        assignedUserName = body.assignedUserName;
    }

    return { name: body.name, description, deadline, completed, assignedUser, assignedUserName };
}

module.exports = { parseUserBody, parseTaskBody };