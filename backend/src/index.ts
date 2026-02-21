import dotenv from "dotenv";
import app from "./app.js";
import logger from "./utils/logger.js";

dotenv.config();

const port = process.env.PORT || 3001;

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
