'use strict';

module.exports = function(grunt) {

  require('load-grunt-tasks')(grunt);

  // Project configuration.
  grunt.initConfig({
    jadeFiles: ['src/jade/index.jade', 'src/jade/design.jade', 'src/jade/code.jade', 'src/jade/games.jade', 'src/jade/dota.jade', 'src/jade/tf2.jade'],

    pkg: grunt.file.readJSON('package.json'),
    jade: {
      compile: {
        options: {
          pretty: true
        },
        files: [ {
          cwd: 'src/jade',
          src: ['*.jade', '!includes/*.jade', '!layout.jade'],
          dest: '',
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
          'css/style.css': 'src/less/style.less'
        }
      }
    },
    eslint: {
        src: 'src/js/*.js'
    },
    uglify: {
        production: {
          options: {
            mangle: false,
            soureMap: false
          },
          files: {
            'js/main.min.js': 'src/js/*.js'
          }
        }
    },
    watch: {
      less: {
        files: ['src/less/*.less'],
        tasks: ['less']
      },
      uglify: {
        files: ['src/js/*.js'],
        tasks: ['uglify']
      },
      jade: {
        files: ['**/*.jade'],
        tasks: ['jade']
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
