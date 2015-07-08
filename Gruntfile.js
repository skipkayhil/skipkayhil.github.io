'use strict';

module.exports = function(grunt) {

  require('load-grunt-tasks')(grunt);

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    jade: {
      compile: {
        options: {},
        files: [ {
          cwd: 'src/jade',
          src: '**/*.jade',
          dest: '/',
          expand: true,
          ext: '.html'
        } ]
      }
    },
    less: {
      site: {
        options: {
          compress: true,
          cleancss: true
        },
        files: {
          'css/stylesheet.css': 'src/less/stylesheet.less'
        }
      }
    },
    eslint: {
        target: []
    },
    uglify: {
        production: {
          options: {
            mangle: false,
            soureMap: false
          },
          files: {
            'js/main.js': 'src/js/*.js'
          }
        }
    },
    watch: {
      less: {
        files: ['src/less/*.less'],
        tasks: ['less']
      },
      js: {
        files: ['src/js/*.js'],
        tasks: ['uglify']
      },
      livereload: {
          options: {
            livereload: true
          },
          files: ['css/*', 'js/*', '*.html']
      }
    }
  });

  // Default task.
  grunt.registerTask('default', ['eslint']);

};
