import Layout from "../components/Layout";
import { Link } from "../components/Router";

export default () => (
  <Layout>
    <h1>404</h1>
    <p>
      go back <Link to="/">home</Link>
    </p>
  </Layout>
);
