from flask import Flask
import os
from routes.api_routes import bp


def create_app():
    app = Flask(__name__)
    app.register_blueprint(bp)
    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
