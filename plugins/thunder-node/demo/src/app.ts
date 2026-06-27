import express from 'express';
import ordersRouter from './orders/orders.routes';

const app = express();
app.use(ordersRouter);
app.listen(3000, () => console.log('listening'));

export default app;
