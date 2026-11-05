const ID_RE = /^[0-9a-fA-F]{24}$/;

const isValidId = (v) => typeof v === 'string' && ID_RE.test(v);

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function send(res, status, message, data) {
    res.status(status).json({ message, data });
}

const FORBIDDEN_OPERATORS = new Set(['$where', '$function', '$accumulator']);

function containsForbidden(v) {
    if (Array.isArray(v)) 
        return v.some(containsForbidden);

    if (v && typeof v === 'object') {
        return Object.entries(v).some(([k, x]) => FORBIDDEN_OPERATORS.has(k) || containsForbidden(x));
    }
    return false;
}

function badParam(name) {
    return new ApiError(400, `The "${name}" parameter is not valid. Please check its value and try again.`);
}

function parseJsonObject(req, name) {
    const raw = req.query[name];
    if (raw === undefined) 
        return undefined;

    if (typeof raw !== 'string') 
        throw badParam(name);

    let value;
    try {
        value = JSON.parse(raw);
    } catch {
        throw badParam(name);
    }

    if (value === null || typeof value !== 'object' || Array.isArray(value)) 
        throw badParam(name);

    if (name === 'where' && containsForbidden(value)) 
        throw badParam(name);

    return value;
}

function parseSort(req) {
    const sort = parseJsonObject(req, 'sort');
    if (sort === undefined) 
        return undefined;

    for (const dir of Object.values(sort)) {
        if (dir !== 1 && dir !== -1) 
            throw badParam('sort');
    }

    return sort;
}

function parseSelect(req) {
    const select = parseJsonObject(req, 'select');
    if (select === undefined) 
        return undefined;

    let includes = 0;
    let excludes = 0;
    for (const [field, v] of Object.entries(select)) {
        if (v !== 0 && v !== 1 && v !== true && v !== false)
             throw badParam('select');

        if (field === '_id') 
            continue;

        if (v === 1 || v === true) 
            includes++;

        else excludes++;
    }
    
    if (includes > 0 && excludes > 0) 
        throw badParam('select');

    return select;
}

function parseNonNegativeInt(req, name) {
    const raw = req.query[name];
    if (raw === undefined) 
        return undefined;

    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim()))
         throw badParam(name);

    return Number(raw.trim());
}

function parseCount(req) {
    const raw = req.query.count;
    if (raw === undefined) 
        return false;

    if (typeof raw === 'string') {
        const v = raw.trim().toLowerCase();
        if (v === 'true') 
            return true;

        if (v === 'false') 
            return false;
    }
    throw badParam('count');
}

function isBadQueryError(err) {
    if (!err) 
        return false;

    if (err.name === 'CastError' || err.name === 'StrictModeError') 
        return true;

    if (err.name === 'MongoServerError') {
        return [2, 9, 14, 15, 16, 17, 51, 52].includes(err.code) || (err.code >= 31200 && err.code < 31300);
    }

    return false;
}

function buildListQuery(Model, req, defaultLimit) {
    const where = parseJsonObject(req, 'where') || {};
    const sort = parseSort(req);
    const select = parseSelect(req);
    const skip = parseNonNegativeInt(req, 'skip');
    const limit = parseNonNegativeInt(req, 'limit');
    const count = parseCount(req);

    if (count)
        return Model.countDocuments(where);

    const query = Model.find(where);
    if (sort) 
        query.sort(sort._id === undefined ? { ...sort, _id: 1 } : sort);

    if (select)
        query.select(select);

    if (skip !== undefined) 
        query.skip(skip);

    if (limit !== undefined) 
        query.limit(limit);

    else if (defaultLimit) 
        query.limit(defaultLimit);

    return query;
}

async function assertValid(doc) {
    try {
        await doc.validate();
    } catch (err) {
        if (err && err.name === 'ValidationError') 
            throw new ApiError(400, 'The request contains invalid data.');

        throw err;
    }
}

function notFoundHandler(req, res) {
    send(res, 404, 'The requested resource was not found.', {});
}

function handleError(res, err) {
    if (err instanceof ApiError) 
        return send(res, err.status, err.message, {});

    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
        return send(res, 400, 'The request body is not valid JSON.', {});
    }

    if (err && err.code === 11000) {
        return send(res, 400, 'A user with that email already exists.', {});
    }

    if (err && err.name === 'ValidationError') {
        return send(res, 400, 'The request contains invalid data.', {});
    }

    if (isBadQueryError(err)) {
        return send(res, 400, 'The request contains a value that could not be understood. Please check it and try again.', {});
    }

    console.error(err);
    return send(res, 500, 'Something went wrong on the server. Please try again later.', {});
}

function errorHandler(err, req, res, next) {
    if (res.headersSent)
        return next(err);

    return handleError(res, err);
}

module.exports = {
    ApiError,
    isValidId,
    send,
    parseSelect,
    buildListQuery,
    assertValid,
    handleError,
    notFoundHandler,
    errorHandler
};