import { RequestHandler } from "express";
import trafficStatisticsService from "@/services/trafficStatistics.service.js";
import cameraService from "@/services/camera.service.js";
import cameraImageModel from "@/models/cameraImage.model.js";

export default new (class ViewController {
  /* ----------------------------- Statistics Home Page ----------------------------- */
  statisticsHomePage: RequestHandler = async (req, res, next) => {
    try {
      // Render the statistics dashboard page
      res.render("pages/statistics-home", {
        layout: "traffic-dashboard",
        pageTitle: "Thống Kê Giao Thông",
      });
    } catch (error) {
      console.error("Error rendering statistics home page:", error);
      res.render("pages/statistics-home", {
        layout: "traffic-dashboard",
        pageTitle: "Thống Kê Giao Thông",
        error: "Không thể tải dữ liệu thống kê",
      });
    }
  };

  /* ----------------------------- Capture Page ----------------------------- */
  capturePage: RequestHandler = (req, res, next) => {
    res.render("pages/capture");
  };

  /* ----------------------------- Simulation Page ----------------------------- */
  simulationPage: RequestHandler = (req, res, next) => {
    res.render("pages/simulation");
  };

  /* ----------------------------- Create Camera Page ----------------------------- */
  createCameraPage: RequestHandler = (req, res, next) => {
    res.render("pages/add-camera", {
      layout: "traffic-dashboard",
      pageTitle: "Thêm Camera Mới",
    });
  };

  /* ----------------------------- Camera Management Page ----------------------------- */
  cameraManagementPage: RequestHandler = (req, res, next) => {
    res.render("pages/camera-management", {
      layout: "traffic-dashboard",
      pageTitle: "Quản lý Camera",
      helpers: {
        add: (a: number, b: number) => a + b, // Helper để hiển thị số trang
      },
    });
  };

  /* ----------------------------- View Camera Detail Page ----------------------------- */
  viewCameraDetail: RequestHandler = (req, res, next) => {
    const { cameraId } = req.params;

    res.render("pages/camera-view", {
      layout: "traffic-dashboard",
      pageTitle: `Camera ${cameraId}`,
    });
  };

  /* ----------------------------- Camera Preview Page ----------------------------- */
  cameraPreviewPage: RequestHandler = (req, res, next) => {
    res.render("pages/camera-preview", {
      layout: "traffic-dashboard",
      pageTitle: "Xem trực tiếp từ Camera AI",
      styles: ["/css/camera-preview.css"],
    });
  };

  /* ----------------------------- Demo Page ----------------------------- */
  demoPage: RequestHandler = (req, res, next) => {
    res.render("pages/demo");
  };

  /* ----------------------------- Combined Page ----------------------------- */
  combinedPage: RequestHandler = (req, res, next) => {
    res.render("pages/combined");
  };

  /* ----------------------------- Violation Review Page ----------------------------- */
  /* ----------------------------- Violation Review Page ----------------------------- */
  violationReviewPage: RequestHandler = (req, res, next) => {
    res.render("pages/violation-review", {
      layout: "traffic-dashboard",
      pageTitle: "Duyệt Vi Phạm Giao Thông",
    });
  };
})();
