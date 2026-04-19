from flask import Flask
from routes.api_routes import bp


def create_app():
    app = Flask(__name__)
    app.register_blueprint(bp)
    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
