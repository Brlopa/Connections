import { Router, type IRouter } from "express";
import healthRouter from "./health";
import transportRouter from "./transport";

const router: IRouter = Router();

router.use(healthRouter);
router.use(transportRouter);

export default router;
