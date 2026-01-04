import viewController from "@/controllers/view.controller.js";
import licensePlateController from "@/controllers/licensePlate.controller.js";
import { Router } from "express";

const viewsRouter = Router();

viewsRouter.get("/", viewController.statisticsHomePage); // New home page route

viewsRouter.get("/capture", viewController.capturePage);

viewsRouter.get("/simulation", viewController.simulationPage);

viewsRouter.get("/preview", viewController.cameraPreviewPage);

viewsRouter.get("/cameras", viewController.cameraManagementPage);

viewsRouter.get("/cameras/add", viewController.createCameraPage);

viewsRouter.get("/cameras/:cameraId", viewController.viewCameraDetail);

viewsRouter.get("/demo", viewController.demoPage);

viewsRouter.get("/combined", viewController.combinedPage);

viewsRouter.get("/violations/review", viewController.violationReviewPage);

viewsRouter.get("/admin", async (req, res) => {
  res.render("pages/admin", {
    title: "Media Server Admin",
    layout: "traffic-dashboard",
  });
});

viewsRouter.get(
  "/license-plates/search",
  licensePlateController.renderSearchPage
);

export default viewsRouter;
