import { Router } from 'express';
import { TrackedVehicleController } from '@/controllers/trackedVehicle.controller.js';

const router = Router();

router.get('/', (req, res) => { TrackedVehicleController.getAll(req, res); });
router.post('/', (req, res) => { TrackedVehicleController.create(req, res); });
router.delete('/:id', (req, res) => { TrackedVehicleController.delete(req, res); });

export default router;
