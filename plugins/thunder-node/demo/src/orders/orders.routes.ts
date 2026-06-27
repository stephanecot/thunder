import { Router } from 'express';
import { OrderService } from './orders.service';

const router = Router();
const service = new OrderService();

router.get('/orders', (req, res) => res.json(service.list()));
router.post('/orders', (req, res) => res.json(service.create(req.body)));
router.delete('/orders/:id', (req, res) => res.json(service.remove(req.params.id)));

export default router;
