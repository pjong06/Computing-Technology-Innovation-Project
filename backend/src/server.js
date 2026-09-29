const express = require("express");

const plantRoutes = require("./routes/plants");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use("/api/plants", plantRoutes);

app.get("/", (req, res) => {
    res.json({
        message: "Niah Biodiversity Backend API is running"
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});