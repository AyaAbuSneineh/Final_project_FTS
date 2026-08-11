import type { Request ,Response,NextFunction} from "express";
import {BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError, ServiceUnavailableError} from "../errors.js";

export function errorMiddleware(err :Error,req:Request,res :Response,next :NextFunction) {
    console.log(err) ;
    if ("type" in err &&err.type === "entity.parse.failed") {
        res.status(400).json({error: "malformed JSON",});
    }
    
    if (err instanceof BadRequestError) {
        if (err.details !== undefined) {
            res.status(err.statusCode).json(err.details);
        }

        res.status(err.statusCode).json({error: err.message,});
    }
    if (err instanceof ServiceUnavailableError) {
        res.status(err.statusCode).json({status: "unavailable",});
    }
    if (err instanceof UnauthorizedError 
        || err instanceof ForbiddenError 
        || err instanceof NotFoundError
    ){
        res.status(err.statusCode).json({error :err.message});
    }
    else {
        res.status(500).json({error:"Something went wrong on our end"}) ;
    }
}