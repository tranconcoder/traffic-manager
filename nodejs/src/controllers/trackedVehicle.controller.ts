import { Request, Response } from 'express';
import TrackedVehicle from '@/models/trackedVehicle.model.js';
import { errorResponse, successResponse } from '@/utils/response.util.js'; // Assuming util exists or implement standard response

export class TrackedVehicleController {

    // Get all tracked vehicles
    static async getAll(req: Request, res: Response) {
        try {
            const vehicles = await TrackedVehicle.find().sort({ createdAt: -1 });
            return successResponse(res, vehicles);
        } catch (error) {
            console.error('Error getting tracked vehicles:', error);
            return errorResponse(res, 500, 'Internal Server Error');
        }
    }

    // Create new tracked vehicle
    static async create(req: Request, res: Response) {
        try {
            const { license_plate, reason, description } = req.body;

            if (!license_plate || !reason) {
                return errorResponse(res, 400, 'License plate and reason are required');
            }

            // Check if exists
            const existing = await TrackedVehicle.findOne({ license_plate: license_plate.toUpperCase() });
            if (existing) {
                return errorResponse(res, 409, 'Vehicle already tracked');
            }

            const newVehicle = await TrackedVehicle.create({
                license_plate: license_plate.toUpperCase(),
                reason,
                description
            });

            return successResponse(res, newVehicle);
        } catch (error) {
            console.error('Error creating tracked vehicle:', error);
            return errorResponse(res, 500, 'Internal Server Error');
        }
    }

    // Delete tracked vehicle
    static async delete(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const deleted = await TrackedVehicle.findByIdAndDelete(id);

            if (!deleted) {
                return errorResponse(res, 404, 'Vehicle not found');
            }

            return successResponse(res, null);
        } catch (error) {
            console.error('Error deleting tracked vehicle:', error);
            return errorResponse(res, 500, 'Internal Server Error');
        }
    }
}
